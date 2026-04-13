const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    RARITY, RARITY_ORDER,
    getOwnedItems, getEquipped, equipItem, getItemById,
} = require('../../utils/inventory');
const logger = require('../../utils/logger');

const CATEGORY_LABELS = {
    theme: 'Themes',
};

function buildFooter(interaction) {
    return {
        text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`,
        iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View and manage your owned items.')
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('Show all owned items across categories.'))
        .addSubcommand(sub =>
            sub.setName('equip')
                .setDescription('Equip an owned item.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('The item to equip.')
                        .setRequired(true)
                        .setAutocomplete(true))),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const owned = await getOwnedItems(interaction.user.id);
        const filtered = owned
            .filter(i =>
                i.id.toLowerCase().startsWith(focused) ||
                i.name.toLowerCase().startsWith(focused))
            .slice(0, 25)
            .map(i => ({ name: `${i.emoji ? `${i.emoji} ` : ''}${i.name} \u2014 ${CATEGORY_LABELS[i.category] || i.category}`, value: i.id }));
        await interaction.respond(filtered);
    },

    async execute(interaction) {
        const user = interaction.user;
        const sub = interaction.options.getSubcommand();
        const footer = buildFooter(interaction);

        switch (sub) {
            // ── /inventory view ─────────────────────────────────────
            case 'view': {
                const owned = await getOwnedItems(user.id);
                const equipped = await getEquipped(user.id);

                if (owned.length === 0) {
                    const embed = new EmbedBuilder()
                        .setDescription('Your inventory is empty. Check `/shop browse` to find something!')
                        .setColor(0xFFAA00)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const byCategory = {};
                for (const item of owned) {
                    (byCategory[item.category] || (byCategory[item.category] = [])).push(item);
                }

                let desc = '';
                for (const category of Object.keys(byCategory)) {
                    const items = byCategory[category];
                    items.sort((a, b) => {
                        const ar = RARITY[a.rarity]?.order ?? -1;
                        const br = RARITY[b.rarity]?.order ?? -1;
                        if (br !== ar) return br - ar;
                        return a.name.localeCompare(b.name);
                    });
                    desc += `**${CATEGORY_LABELS[category] || category}**\n`;
                    for (const i of items) {
                        const isEquipped = equipped[category] === i.id;
                        const rarityLabel = i.rarity ? ` \u00b7 ${RARITY[i.rarity].label}` : '';
                        const prefix = i.emoji ? `${i.emoji} ` : '';
                        desc += `${prefix}**${i.name}**${rarityLabel}${isEquipped ? ' \u2705' : ''}\n`;
                    }
                    desc += '\n';
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName} | Inventory`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(desc.trim())
                    .setColor(0x5865F2)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── /inventory equip ────────────────────────────────────
            case 'equip': {
                const itemId = interaction.options.getString('item');
                const result = await equipItem(user.id, itemId);
                const item = getItemById(itemId);

                if (!result.success) {
                    let desc;
                    const name = item?.name || itemId;
                    switch (result.error) {
                        case 'unknown_item':
                        case 'unknown_theme':     desc = `Unknown item \`${itemId}\`.`; break;
                        case 'not_owned':         desc = `You don't own **${name}**. Check \`/shop browse\` to purchase it.`; break;
                        case 'unknown_category':  desc = `**${name}** can't be equipped.`; break;
                        default:                  desc = `Equip failed: \`${result.error}\`.`;
                    }
                    const embed = new EmbedBuilder()
                        .setDescription(desc)
                        .setColor(0xFF0000)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`Equipped ${item?.emoji ? `${item.emoji} ` : ''}**${item?.name || itemId}**!${item?.description ? `\n${item.description}` : ''}`)
                    .setColor(0x00FF00)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    },
};
