const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getThemeList } = require('../../themes/configs');
const { getOwnedThemes, getEquippedTheme } = require('../../themes/manager');
const {
    RARITY, RARITY_ORDER,
    equipItem, getItemById, ownsItem,
    buildFooter, formatPrice, buildThemeInfoEmbed, buildEquipResultEmbed,
    respondThemeAutocomplete,
    PREVIEW_GAMES, GAME_LABELS, GAME_EMOJIS, GAME_FILES,
    getPreviewAttachment,
} = require('../../utils/inventory');
const logger = require('../../utils/logger');

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
                .setDescription('Preview a theme with game images.')
                .addStringOption(opt =>
                    opt.setName('theme_name')
                        .setDescription('The theme to preview.')
                        .setRequired(true)
                        .setAutocomplete(true))),

    async autocomplete(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'set') {
            return respondThemeAutocomplete(interaction, { onlyOwned: true });
        }
        // 'info' and fallback: show all themes
        return respondThemeAutocomplete(interaction, { onlyOwned: false });
    },

    async execute(interaction) {
        const user = interaction.user;
        const sub = interaction.options.getSubcommand();
        const footer = buildFooter(interaction);

        switch (sub) {
            // ── /theme set ──────────────────────────────────────────
            case 'set': {
                const themeId = interaction.options.getString('theme_name');
                const result = await equipItem(user.id, themeId);
                const { embed, ephemeral } = buildEquipResultEmbed({ result, itemId: themeId, user, footer });
                return interaction.reply({ embeds: [embed], ephemeral });
            }

            // ── /theme list ─────────────────────────────────────────
            case 'list': {
                const allThemes = getThemeList();
                const owned = await getOwnedThemes(user.id);
                const equipped = await getEquippedTheme(user.id);

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
                            ? ' ✅'
                            : isOwned
                                ? ' ✔️'
                                : ` 🔒 ${formatPrice(t.price)}`;
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

            // ── /theme info (with game preview pagination) ──────────
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

                const isOwned = await ownsItem(user.id, themeId);
                const embed = buildThemeInfoEmbed({ item, isOwned, footer });
                await interaction.deferReply({ ephemeral: true });

                const attachments = {};
                for (const game of PREVIEW_GAMES) {
                    attachments[game] = await getPreviewAttachment(themeId, game);
                }

                let currentPage = 0;
                let currentGame = PREVIEW_GAMES[currentPage];

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('prev_game')
                            .setLabel(`${GAME_EMOJIS[PREVIEW_GAMES[0]]} ${GAME_LABELS[PREVIEW_GAMES[0]]}`)
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('next_game')
                            .setLabel(`${GAME_EMOJIS[PREVIEW_GAMES[1]]} ${GAME_LABELS[PREVIEW_GAMES[1]]}`)
                            .setStyle(ButtonStyle.Primary),
                    );

                const currentAttachment = attachments[currentGame];
                if (currentAttachment) {
                    embed.setImage(`attachment://${GAME_FILES[currentGame]}`);
                }

                const msg = await interaction.editReply({
                    embeds: [embed],
                    components: [row],
                    files: currentAttachment ? [currentAttachment] : [],
                });

                const filter = i => (i.customId === 'prev_game' || i.customId === 'next_game')
                    && i.user.id === interaction.user.id;
                const collector = msg.createMessageComponentCollector({ filter, time: 60000 });

                collector.on('collect', async i => {
                    await i.deferUpdate();

                    if (i.customId === 'prev_game') currentPage--;
                    else if (i.customId === 'next_game') currentPage++;
                    currentPage = Math.max(0, Math.min(PREVIEW_GAMES.length - 1, currentPage));
                    currentGame = PREVIEW_GAMES[currentPage];

                    row.components[0]
                        .setDisabled(currentPage === 0)
                        .setLabel(currentPage > 0
                            ? `${GAME_EMOJIS[PREVIEW_GAMES[currentPage - 1]]} ${GAME_LABELS[PREVIEW_GAMES[currentPage - 1]]}`
                            : `${GAME_EMOJIS[PREVIEW_GAMES[0]]} ${GAME_LABELS[PREVIEW_GAMES[0]]}`);
                    row.components[1]
                        .setDisabled(currentPage === PREVIEW_GAMES.length - 1)
                        .setLabel(currentPage < PREVIEW_GAMES.length - 1
                            ? `${GAME_EMOJIS[PREVIEW_GAMES[currentPage + 1]]} ${GAME_LABELS[PREVIEW_GAMES[currentPage + 1]]}`
                            : `${GAME_EMOJIS[PREVIEW_GAMES[2]]} ${GAME_LABELS[PREVIEW_GAMES[2]]}`);

                    const pageEmbed = buildThemeInfoEmbed({ item, isOwned, footer });
                    const newAttachment = attachments[currentGame];
                    if (newAttachment) {
                        pageEmbed.setImage(`attachment://${GAME_FILES[currentGame]}`);
                    }
                    pageEmbed.setFooter({ text: `${footer.text} | ${GAME_EMOJIS[currentGame]} ${GAME_LABELS[currentGame]} Preview | Page ${currentPage + 1}/${PREVIEW_GAMES.length}`, iconURL: footer.iconURL });

                    collector.resetTimer();
                    i.editReply({
                        embeds: [pageEmbed],
                        components: [row],
                        files: newAttachment ? [newAttachment] : [],
                    });
                });

                collector.on('end', () => {
                    interaction.deleteReply().catch(() => {});
                });

                return;
            }
        }
    },
};