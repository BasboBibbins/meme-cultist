const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getThemeList } = require('../../themes/configs');
const { getThemeColors } = require('../../themes/resolver');
const { getEquippedTheme, getOwnedThemes, ownsTheme, equipTheme } = require('../../themes/manager');
const { CURRENCY_NAME } = require('../../config.js');
const logger = require('../../utils/logger');

const TIER_LABELS = {
    colorway: 'Colorway',
    styled:   'Styled',
    full:     'Full',
};

const TIER_ORDER = ['full', 'styled', 'colorway'];

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
            filtered.map(t => ({ name: `${t.name} \u2014 ${t.description}`, value: t.id }))
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
                const result = await equipTheme(user.id, themeId);

                if (!result.success) {
                    const allThemes = getThemeList();
                    const theme = allThemes.find(t => t.id === themeId);

                    let desc;
                    if (result.error === 'unknown_theme') {
                        desc = `Unknown theme \`${themeId}\`.`;
                    } else {
                        desc = `You don't own **${theme?.name || themeId}**.`
                             + `\nCheck the shop to purchase it!`;
                    }

                    const embed = new EmbedBuilder()
                        .setDescription(desc)
                        .setColor(0xFF0000)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const allThemes = getThemeList();
                const theme = allThemes.find(t => t.id === themeId);
                const embed = new EmbedBuilder()
                    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`Theme set to **${theme?.name || themeId}**!\n${theme?.description || ''}`)
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

                const grouped = {};
                for (const tier of TIER_ORDER) grouped[tier] = [];
                for (const t of allThemes) {
                    (grouped[t.tier] || (grouped[t.tier] = [])).push(t);
                }

                let desc = '';
                for (const tier of TIER_ORDER) {
                    const items = grouped[tier];
                    if (!items || items.length === 0) continue;

                    desc += `**${TIER_LABELS[tier] || tier} Themes**\n`;
                    for (const t of items) {
                        const isOwned = owned.includes(t.id);
                        const isEquipped = t.id === equipped;
                        const status = isEquipped ? ' \u2705' : isOwned ? ' \u2714\uFE0F' : ` \u{1F512} ${t.price.toLocaleString()} ${CURRENCY_NAME}`;
                        desc += `\`${t.id}\` **${t.name}**${status}\n`;
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
                const allThemes = getThemeList();
                const theme = allThemes.find(t => t.id === themeId);

                if (!theme) {
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

                let desc = `${theme.description}\n\n`;
                desc += `**Tier:** ${TIER_LABELS[theme.tier] || theme.tier}\n`;
                desc += `**Price:** ${theme.price === 0 ? 'Free' : `${theme.price.toLocaleString()} ${CURRENCY_NAME}`}\n`;
                desc += `**Status:** ${isOwned ? 'Owned' : 'Locked'}\n`;
                desc += `\n**Sample Colors:**\n${swatch}`;

                // Use the theme's feltColor as embed accent if it looks like a hex
                const embedColor = colors.embedColor || parseInt(String(colors.feltColor).replace('#', ''), 16) || 0x5865F2;

                const embed = new EmbedBuilder()
                    .setTitle(theme.name)
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
                    desc += `\`${t.id}\` **${t.name}**${isEquipped ? ' \u2705 Equipped' : ''}\n`;
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
