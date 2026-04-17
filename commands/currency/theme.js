const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getThemeList } = require('../../themes/configs');
const { getThemeColors } = require('../../themes/resolver');
const { getEquippedTheme, getOwnedThemes, ownsTheme } = require('../../themes/manager');
const { CURRENCY_NAME } = require('../../config.js');
const { RARITY, RARITY_ORDER, equipItem, getItemById, isThemeAvailable, formatAvailability } = require('../../utils/inventory');
const logger = require('../../utils/logger');

const TIER_LABELS = {
    colorway: 'Colorway',
    styled:   'Styled',
    full:     'Full',
    limited:  'Limited',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('theme')
        .setDescription('Manage your casino visual theme.')
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('Equip an owned theme.')
                .addStringOption(opt =>
                    opt.setName('theme_name')
                        .setDescription('The theme to equip.')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View all available themes.'))
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('Preview a theme\'s details.')
                .addStringOption(opt =>
                    opt.setName('theme_name')
                        .setDescription('The theme to preview.')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('owned')
                .setDescription('View your owned themes.')),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        const list = getThemeList();
        const filtered = list
            .filter(t =>
                t.name.toLowerCase().startsWith(focused.toLowerCase()) ||
                t.id.toLowerCase().startsWith(focused.toLowerCase()))
            .slice(0, 25);
        await interaction.respond(
            filtered.map(t => ({ name: `${t.emoji ? `${t.emoji} ` : ''}${t.name} \u2014 ${t.description}`, value: t.id }))
        );
    },

    async execute(interaction) {
        const user = interaction.user;
        const sub = interaction.options.getSubcommand();

        const footer = {
            text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`,
            iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }),
        };

        switch (sub) {
            // ── /theme set ──────────────────────────────────────────
            case 'set': {
                const themeId = interaction.options.getString('theme_name');
                const result = await equipItem(user.id, themeId);

                if (!result.success) {
                    const item = getItemById(themeId);
                    let desc;
                    if (result.error === 'unknown_item' || result.error === 'unknown_theme') {
                        desc = `Unknown theme \`${themeId}\`.`;
                    } else if (result.error === 'not_owned') {
                        desc = `You don't own ${item?.emoji ? `${item.emoji} ` : ''}**${item?.name || themeId}**.\nCheck \`/shop browse\` to purchase it!`;
                    } else {
                        desc = `Equip failed: \`${result.error}\`.`;
                    }

                    const embed = new EmbedBuilder()
                        .setDescription(desc)
                        .setColor(0xFF0000)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const item = getItemById(themeId);
                const embed = new EmbedBuilder()
                    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`Theme set to ${item?.emoji ? `${item.emoji} ` : ''}**${item?.name || themeId}**!\n${item?.description || ''}`)
                    .setColor(0x00FF00)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── /theme list ─────────────────────────────────────────
            case 'list': {
                const allThemes = getThemeList();
                const owned = await getOwnedThemes(user.id);
                const equipped = await getEquippedTheme(user.id);

                // Group by rarity (derived from weight). Classic/minimal
                // have weight 0 and go into an "Unlisted" bucket.
                const grouped = {};
                for (const t of allThemes) {
                    const item = getItemById(t.id);
                    const bucket = item?.rarity || 'unlisted';
                    (grouped[bucket] || (grouped[bucket] = [])).push(t);
                }

                const order = [...RARITY_ORDER, 'unlisted'];

                let desc = '';
                for (const bucket of order) {
                    const items = grouped[bucket];
                    if (!items || items.length === 0) continue;
                    const label = bucket === 'unlisted' ? 'Default' : RARITY[bucket].label;
                    desc += `**${label}**\n`;
                    for (const t of items) {
                        const isOwned = owned.includes(t.id);
                        const isEquipped = t.id === equipped;
                        const status = isEquipped
                            ? ' \u2705'
                            : isOwned
                                ? ' \u2714\uFE0F'
                                : ` \u{1F512} ${t.price.toLocaleString()} ${CURRENCY_NAME}`;
                        const prefix = t.emoji ? `${t.emoji} ` : '';
                        desc += `${prefix}**${t.name}**${status}\n`;
                    }
                    desc += '\n';
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName} | Themes`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(desc.trim())
                    .setColor(0x5865F2)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── /theme info ─────────────────────────────────────────
            case 'info': {
                const themeId = interaction.options.getString('theme_name');
                const item = getItemById(themeId);

                if (!item) {
                    const embed = new EmbedBuilder()
                        .setDescription(`Unknown theme \`${themeId}\`.`)
                        .setColor(0xFF0000)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const isOwned = await ownsTheme(user.id, themeId);
                const colors = getThemeColors(themeId, 'slots');

                const swatch = [colors.feltColor, colors.gold, colors.textWin, colors.textLoss]
                    .filter(Boolean)
                    .map(c => `\`${c}\``)
                    .join('  ');

                const rarityLabel = item.rarity ? RARITY[item.rarity].label : 'Default';
                const styleLabel = TIER_LABELS[item.tier] || item.tier;

                let desc = `${item.description}\n\n`;
                desc += `**Rarity:** ${rarityLabel}\n`;
                desc += `**Style:** ${styleLabel}\n`;
                if (item.tier === 'limited' && item.availability) {
                    desc += `**Availability:** ${formatAvailability(item.availability)}\n`;
                    desc += `**Season:** ${isThemeAvailable(item.availability) ? 'In Season' : 'Out of Season'}\n`;
                }
                desc += `**Price:** ${item.price === 0 ? 'Free' : `${item.price.toLocaleString()} ${CURRENCY_NAME}`}\n`;
                desc += `**Status:** ${isOwned ? 'Owned' : 'Locked'}\n`;
                desc += `\n**Sample Colors:**\n${swatch}`;

                const embedColor = colors.embedColor || parseInt(String(colors.feltColor).replace('#', ''), 16) || 0x5865F2;

                const embed = new EmbedBuilder()
                    .setTitle(`${item.emoji ? `${item.emoji} ` : ''}${item.name}`)
                    .setDescription(desc)
                    .setColor(embedColor)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── /theme owned ────────────────────────────────────────
            case 'owned': {
                const allThemes = getThemeList();
                const owned = await getOwnedThemes(user.id);
                const equipped = await getEquippedTheme(user.id);

                const ownedThemes = allThemes.filter(t => owned.includes(t.id));

                if (ownedThemes.length === 0) {
                    const embed = new EmbedBuilder()
                        .setDescription('You only have the **Classic** theme. Check the shop for more!')
                        .setColor(0xFFAA00)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                let desc = '';
                for (const t of ownedThemes) {
                    const isEquipped = t.id === equipped;
                    const prefix = t.emoji ? `${t.emoji} ` : '';
                    desc += `${prefix}**${t.name}**${isEquipped ? ' \u2705 Equipped' : ''}\n`;
                }

                const embed = new EmbedBuilder()
                    .setAuthor({ name: `${user.displayName} | Owned Themes`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(desc.trim())
                    .setColor(0x5865F2)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
        }
    },
};
