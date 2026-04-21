const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CURRENCY_NAME } = require('../../config.js');
const logger = require('../../utils/logger');
const { formatTimeSince } = require('../../utils/time');
const {
    RARITY, RARITY_ORDER,
    getItemById,
    getDailyShopStock, msUntilNextShopReset,
    ownsItem, purchaseItem,
    isThemeAvailable, formatAvailability,
    buildFooter, formatPrice, buildThemeInfoEmbed,
    PREVIEW_GAMES, GAME_LABELS, GAME_EMOJIS, GAME_FILES,
    getPreviewAttachment,
} = require('../../utils/inventory');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse and purchase items.')
        .addSubcommand(sub =>
            sub.setName('browse')
                .setDescription('View today\'s rotating shop stock.'))
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Purchase an item from today\'s shop.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('The item to purchase.')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(sub =>
            sub.setName('preview')
                .setDescription('Preview an item before buying.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('The item to preview.')
                        .setRequired(true)
                        .setAutocomplete(true))),

    async autocomplete(interaction) {
        const sub = interaction.options.getSubcommand();
        const focused = interaction.options.getFocused().toLowerCase();

        // Both /shop buy and /shop preview only show items currently in the shop
        const pool = getDailyShopStock(interaction.guildId);

        const filtered = pool
            .filter(i =>
                i.id.toLowerCase().startsWith(focused) ||
                i.name.toLowerCase().startsWith(focused))
            .slice(0, 25)
            .map(i => ({ name: `${i.name} ${sub === 'buy' ? `— ${formatPrice(i.price)}` : ''}`, value: i.id }));

        await interaction.respond(filtered);
    },

    async execute(interaction) {
        const user = interaction.user;
        const sub = interaction.options.getSubcommand();
        const footer = buildFooter(interaction);

        switch (sub) {
            // ── /shop browse ────────────────────────────────────────
            case 'browse': {
                const stock = getDailyShopStock(interaction.guildId);
                const ownedFlags = await Promise.all(stock.map(i => ownsItem(user.id, i.id)));

                const grouped = {};
                stock.forEach((item, idx) => {
                    const rarity = item.rarity || 'common';
                    (grouped[rarity] || (grouped[rarity] = [])).push({ ...item, owned: ownedFlags[idx] });
                });

                let desc = '';
                for (const rarity of RARITY_ORDER) {
                    const items = grouped[rarity];
                    if (!items || items.length === 0) continue;
                    desc += `**${RARITY[rarity].label}**\n`;
                    for (const i of items) {
                        const mark = i.owned ? ' ✅' : '';
                        const prefix = i.emoji ? `${i.emoji} ` : '';
                        desc += `${prefix}**${i.name}** · ${formatPrice(i.price)}${mark}\n`;
                    }
                    desc += '\n';
                }
                if (!desc) desc = 'The shop is empty today. Check back tomorrow!';

                const resetIn = await formatTimeSince(msUntilNextShopReset());
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `Daily Shop — ${interaction.guild.name}`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setDescription(desc.trim())
                    .setFooter({ ...footer, text: `${footer.text} | Resets in ${resetIn}` })
                    .setColor(0x5865F2)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── /shop buy ───────────────────────────────────────────
            case 'buy': {
                const itemId = interaction.options.getString('item');
                const result = await purchaseItem(user.id, interaction.guildId, itemId);

                if (!result.success) {
                    let desc;
                    const name = result.item?.name || itemId;
                    switch (result.error) {
                        case 'unknown_item':       desc = `Unknown item \`${itemId}\`.`; break;
                        case 'not_in_stock':       desc = `**${name}** is not in today's shop. Try \`/shop browse\`.`; break;
                        case 'not_in_season':      desc = `**${name}** is not currently available. Check back during its availability window.`; break;
                        case 'already_owned':      desc = `You already own **${name}**.`; break;
                        case 'insufficient_funds': desc = `You need **${formatPrice(result.item.price)}** but only have **${(result.balance ?? 0).toLocaleString('en-US')} ${CURRENCY_NAME}**.`; break;
                        default:                   desc = `Purchase failed: \`${result.error}\`.`;
                    }
                    const embed = new EmbedBuilder()
                        .setDescription(desc)
                        .setColor(0xFF0000)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                logger.info(`${user.tag} (${user.id}) purchased ${result.item.id} for ${result.item.price} in guild ${interaction.guildId}`);

                const prefix = result.item.emoji ? `${result.item.emoji} ` : '';
                const embed = new EmbedBuilder()
                    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(
                        `Purchased ${prefix}**${result.item.name}** for **${formatPrice(result.item.price)}**!\n`
                        + `New balance: **${result.newBalance.toLocaleString('en-US')} ${CURRENCY_NAME}**\n\n`
                        + `Use \`/inventory equip ${result.item.id}\` to equip it.`
                    )
                    .setColor(0x00FF00)
                    .setFooter(footer)
                    .setTimestamp();
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // ── /shop preview ───────────────────────────────────────
            case 'preview': {
                const itemId = interaction.options.getString('item');
                const item = getItemById(itemId);
                if (!item) {
                    const embed = new EmbedBuilder()
                        .setDescription(`Unknown item \`${itemId}\`.`)
                        .setColor(0xFF0000)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const isOwned = await ownsItem(user.id, itemId);

                // Non-theme items: static embed
                if (item.category !== 'theme') {
                    const rarityLabel = item.rarity ? RARITY[item.rarity].label : 'Unlisted';
                    const rarityColor = item.rarity ? RARITY[item.rarity].color : 0x5865F2;

                    let desc = `${item.description}\n\n`;
                    desc += `**Rarity:** ${rarityLabel}\n`;
                    if (item.tier === 'limited' && item.availability) {
                        desc += `**Availability:** ${formatAvailability(item.availability)}\n`;
                        desc += `**Season:** ${isThemeAvailable(item.availability) ? 'In Season' : 'Out of Season'}\n`;
                    }
                    desc += `**Price:** ${formatPrice(item.price)}\n`;
                    desc += `**Status:** ${isOwned ? 'Owned' : 'Not Owned'}\n`;

                    const embed = new EmbedBuilder()
                        .setTitle(`${item.emoji ? `${item.emoji} ` : ''}${item.name}`)
                        .setDescription(desc)
                        .setColor(rarityColor)
                        .setFooter(footer)
                        .setTimestamp();
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }

                // Theme items: paginated game previews
                const embed = buildThemeInfoEmbed({ item, isOwned, footer });
                await interaction.deferReply({ ephemeral: true });

                const attachments = {};
                for (const game of PREVIEW_GAMES) {
                    attachments[game] = await getPreviewAttachment(itemId, game);
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

                collector.on('end', (collected, reason) => {
                    logger.debug(`Shop preview collector ended: ${reason}`);
                    interaction.deleteReply().catch(() => {});
                });

                return;
            }
        }
    },
};