const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const { generatePaytable, playSlots } = require('../../utils/slots');
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
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('paytable')
                .setDescription(`View the paytable for the slots.`))
        .addSubcommand(subcommand =>
            subcommand
                .setName('daily')
                .setDescription(`Use your daily free spins.`)),
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

            case 'daily':
                const cooldown = 8.64e+7; // 24 hours
                if (dbUser.cooldowns.freespins > Date.now()) {
                    const timeLeft = new Date(dbUser.cooldowns.freespins - Date.now());
                    logger.debug(`User ${user.username} (${user.id}) daily free spin cooldown is ${timeLeft.getUTCHours()}:${timeLeft.getUTCMinutes()}:${timeLeft.getUTCSeconds()}`)
                    const embed = new EmbedBuilder()
                        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
                        .setDescription(`You have already used your daily free spins! You can use them again in **${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m ${timeLeft.getUTCSeconds()}s**.`)
                        .setColor(0xFF0000)
                        .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                } else {
                    logger.debug(`User ${user.username} (${user.id}) is using their daily free spins.`);
                    await db.set(`${user.id}.cooldowns.freespins`, Date.now() + cooldown);
                    await playSlots(interaction, 0, user);
                }
                break;

            case 'bet':
                const bet = Number(await parseBet(interaction.options.getString('amount'), user.id));

                const error_embed = new EmbedBuilder()
                    .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                    .setColor(0xFF0000)
                    .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
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
                if (bet > await db.get(`${interaction.user.id}.balance`)) {
                    error_embed.setDescription(`You don't have enough ${CURRENCY_NAME}!`);
                    await interaction.reply({ embeds: [error_embed], ephemeral: true });
                    break;
                }

                await db.set(`${user.id}.balance`, await db.get(`${user.id}.balance`) - bet);
                await playSlots(interaction, bet, user);
                break;
        }
    },
};