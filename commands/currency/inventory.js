const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    RARITY, RARITY_ORDER, CATEGORY_LABELS,
    getOwnedItems, getEquipped, equipItem, getItemById,
    buildFooter, buildEquipResultEmbed,
} = require('../../utils/inventory');

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
            .map(i => ({ name: `${i.emoji ? `${i.emoji} ` : ''}${i.name} — ${CATEGORY_LABELS[i.category] || i.category}`, value: i.id }));
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
                        const rarityLabel = i.rarity ? ` · ${RARITY[i.rarity].label}` : '';
                        const prefix = i.emoji ? `${i.emoji} ` : '';
                        desc += `${prefix}**${i.name}**${rarityLabel}${isEquipped ? ' ✅' : ''}\n`;
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
                const { embed, ephemeral } = buildEquipResultEmbed({ result, itemId, user, footer });
                return interaction.reply({ embeds: [embed], ephemeral });
            }
        }
    },
};