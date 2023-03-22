const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription(`Use ${CURRENCY_NAME} to timeout a user. (100 ${CURRENCY_NAME} per minute)`)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription(`Use ${CURRENCY_NAME} to timeout a user. (100 ${CURRENCY_NAME} per minute)`)
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to timeout.')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('duration')
                        .setDescription('The duration of the timeout in minutes.')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(672)),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription(`Use ${CURRENCY_NAME} to remove a timeout from a user. (1000 ${CURRENCY_NAME})`)
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to remove the timeout from.')
                        .setRequired(true))
        ),
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const member = await interaction.guild.members.fetch(user.id);

        const dbUser = await db.get(interaction.user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`, "warn")
            await addNewDBUser(interaction.user);
        }

        const error_embed = new EmbedBuilder()
            .setAuthor({ name: interaction.user.username + "#" + interaction.user.discriminator, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        if (user.bot) {
            error_embed.setDescription(`**${user.username}** is a bot, and therefore cannot be timed out.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        const cost = duration ? duration * 100 : 1000;
        if (dbUser.balance < cost) {
            error_embed.setDescription(`You do not have enough ${CURRENCY_NAME} to timeout **${user.username}** for ${duration} minutes!\nYou need **${cost} ${CURRENCY_NAME}** to timeout **${user.username}** for ${duration} minutes.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        if (interaction.options.getSubcommand() === 'add' && member.communicationDisabledUntilTimestamp > Date.now()) {
            error_embed.setDescription(`**${user.username}** is already in timeout!`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        if (interaction.options.getSubcommand() === 'remove' && member.communicationDisabledUntilTimestamp < Date.now()) {
            error_embed.setDescription(`**${user.username}** is not currently in timeout!`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        const fetchedUser = await user.fetch()
        let accentColor = fetchedUser.hexAccentColor ? fetchedUser.hexAccentColor : randomHexColor();

        await interaction.deferReply();
        const embed = new EmbedBuilder()
            .setColor(`${accentColor}`)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        switch (interaction.options.getSubcommand()) {
            case 'add':
                embed.addFields(
                    { name: "User", value: `${user.username}#${user.discriminator}`, inline: true },
                    { name: "Duration", value: `${duration} minutes`, inline: true },
                    { name: "Cost", value: `${cost} ${CURRENCY_NAME}`, inline: true }
                )
                .setAuthor({ name: `${user.username} has been timed out for ${duration > 60 ? `${duration / 60} hours` : `${duration} minutes`}!`, iconURL: user.displayAvatarURL({ dynamic: true }) }) 
                member.timeout(60_000 * duration);
                await db.sub(`${interaction.user.id}.balance`, cost);
                break;
            case 'remove':
                embed.setAuthor({ name: `${user.username} has been removed from timeout!`, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setDescription(`**${interaction.user.username}** was nice enough to pay **${cost} ${CURRENCY_NAME}** to remove **${user.username}'s** timeout!`);
                console.log(member);
                member.timeout(null); // provide null to remove timeout
                await db.sub(`${interaction.user.id}.balance`, cost);
                break;
        }

        await interaction.editReply({embeds: [embed]});
    },
};