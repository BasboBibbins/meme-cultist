const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME, SLOTS_MAX_LINES, SLOTS_DAILY_COOLDOWN, SLOTS_DAILY_LINES } = require("../../config.js");
const { parseBet } = require('../../utils/betparse');
const { generatePaytable, playSlots } = require('../../utils/slots');
const { getTheme, getThemeList } = require('../../utils/slotsThemes');
const { equipTheme } = require('../../themes/manager');
const { formatTimeLeft } = require('../../utils/time')
const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("slots")
        .setDescription(`Play a game of slots for ${CURRENCY_NAME}.`)
        .addSubcommand(subcommand =>
            subcommand
                .setName('bet')
                .setDescription(`Bet an amount of ${CURRENCY_NAME} on slots.`)
                .addStringOption(option =>
                    option.setName('amount')
                        .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('lines')
                        .setDescription(`Number of paylines to bet on (1-${SLOTS_MAX_LINES})`)
                        .setMinValue(1)
                        .setMaxValue(SLOTS_MAX_LINES)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('paytable')
                .setDescription(`View the paytable for the slots.`))
        .addSubcommand(subcommand =>
            subcommand
                .setName('daily')
                .setDescription(`Use your daily free spins.`))
        .addSubcommand(subcommand =>
            subcommand
                .setName('theme')
                .setDescription('Change your slots visual theme.')
                .addStringOption(option =>
                    option.setName('theme_name')
                        .setDescription('The theme to use.')
                        .setRequired(true)
                        .setAutocomplete(true))),
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
        const option = interaction.options.getSubcommand();
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`);
            await addNewDBUser(user);
        }

        switch (option) {
            case 'paytable':
                await generatePaytable(interaction);
                break;

            case 'theme':
                const themeId = interaction.options.getString('theme_name');
                const result = await equipTheme(user.id, themeId);

                if (!result.success) {
                    const list = getThemeList();
                    let desc;
                    if (result.error === 'unknown_theme') {
                        const available = list.map(t => `\`${t.id}\` - ${t.name}`).join('\n');
                        desc = `Unknown theme \`${themeId}\`.\n\n**Available themes:**\n${available}`;
                    } else {
                        const theme = list.find(t => t.id === themeId);
                        desc = `You don't own **${theme?.name || themeId}**.\nCheck the shop to purchase it!`;
                    }
                    const embed = new EmbedBuilder()
                        .setDescription(desc)
                        .setColor(0xFF0000)
                        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                        .setTimestamp();
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                }

                const selectedTheme = getTheme(themeId);
                const themeEmbed = new EmbedBuilder()
                    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setDescription(`Theme set to **${selectedTheme.name}**!\n${selectedTheme.description}`)
                    .setColor(0x00FF00)
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();
                await interaction.reply({ embeds: [themeEmbed], ephemeral: true });
                break;

            case 'daily':
                if (dbUser.cooldowns.freespins > Date.now()) {
                    const timeLeft = new Date(dbUser.cooldowns.freespins - Date.now());
                    logger.debug(`User ${user.username} (${user.id}) daily free spin cooldown is ${await formatTimeLeft(timeLeft)}`)
                    const embed = new EmbedBuilder()
                        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                        .setDescription(`You have already used your daily free spins! You can use them again in **${await formatTimeLeft(timeLeft)}**.`)
                        .setColor(0xFF0000)
                        .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                        .setTimestamp();
                    return await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    logger.debug(`User ${user.username} (${user.id}) is using their daily free spins.`);
                    await db.set(`${user.id}.cooldowns.freespins`, Date.now() + SLOTS_DAILY_COOLDOWN);
                    await interaction.deferReply();
                    await playSlots(interaction, 0, user, { lines: SLOTS_DAILY_LINES });
                }
                break;

            case 'bet':
                const bet = Number(await parseBet(interaction.options.getString('amount'), user.id));
                const lines = interaction.options.getInteger('lines') || 1;

                const error_embed = new EmbedBuilder()
                    .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .setColor(0xFF0000)
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                    .setTimestamp();

                if (isNaN(bet)) {
                    error_embed.setDescription(`You must bet a number of ${CURRENCY_NAME}!`);
                    await interaction.reply({ embeds: [error_embed], ephemeral: true });
                    break;
                }
                if (bet % 1 !== 0) {
                    error_embed.setDescription(`You must bet a whole number of ${CURRENCY_NAME}!`);
                    await interaction.reply({ embeds: [error_embed], ephemeral: true });
                    break;
                }
                if (bet < 1) {
                    error_embed.setDescription(`You must bet at least 1 ${CURRENCY_NAME}!`);
                    await interaction.reply({ embeds: [error_embed], ephemeral: true });
                    break;
                }

                const totalCost = bet * lines;
                const balance = await db.get(`${interaction.user.id}.balance`);
                if (totalCost > balance) {
                    error_embed.setDescription(`You don't have enough ${CURRENCY_NAME}! (Need ${totalCost.toLocaleString('en-US')}, have ${balance.toLocaleString('en-US')})`);
                    await interaction.reply({ embeds: [error_embed], ephemeral: true });
                    break;
                }

                await interaction.deferReply();
                await db.set(`${user.id}.balance`, balance - totalCost);
                await playSlots(interaction, bet, user, { lines });
                break;
        }
    },
};
