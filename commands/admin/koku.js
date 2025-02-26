const { SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName(CURRENCY_NAME)
        .setDescription(`[ADMIN] Manage ${CURRENCY_NAME} (Currency).`)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription(`[ADMIN] Add ${CURRENCY_NAME} to a user.`)
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to add Koku to.')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount of Koku to add.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription(`[ADMIN] Remove ${CURRENCY_NAME} from a user.`)
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to remove Koku from.')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount of Koku to remove.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription(`[ADMIN] Set ${CURRENCY_NAME} for a user.`)
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to set Koku for.')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The amount of Koku to set.')
                        .setRequired(true))),
    async execute(interaction) {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            await interaction.reply({content: `You do not have permission to use this command.`, ephemeral: true});
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (amount < 0) {
            await interaction.reply({content: `You cannot add, remove, or set negative amounts of ${CURRENCY_NAME}.`, ephemeral: true});
            return;
        }

        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.log(`No database entry for user ${user.username} (${user.id}), creating one...`, "warn")
            await addNewDBUser(user);
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username}'s ${CURRENCY_NAME} balance updated.`, iconURL: interaction.user.displayAvatarURL({dynamic: true}) })
            .setColor(randomHexColor())
            .setTimestamp()
            .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });

        switch (subcommand) {
            case 'add':
                await db.set(`${user.id}.bank`, dbUser.bank + amount);
                logger.log(`Added ${amount} ${CURRENCY_NAME} to ${user.username} (${user.id})'s bank.`);
                embed.setDescription(`Added **${amount}** ${CURRENCY_NAME} to **${user.username}**'s bank.`);
                await interaction.reply({embeds: [embed], ephemeral: true});
                user.send({embeds: [new EmbedBuilder()
                    .setAuthor({ name: `${interaction.user.username} has added ${amount} ${CURRENCY_NAME} to your account in ${interaction.guild.name}!`, iconURL: user.displayAvatarURL({dynamic: true}) })
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 1024 }))
                    .setDescription(`You now have **${dbUser.bank + amount}** ${CURRENCY_NAME} in your bank.\n\n*If you believe this is a mistake, please contact a server administrator.*`)
                    .setColor(randomHexColor())
                    .setTimestamp()
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                ]});
                break;
            case 'remove':
                await db.set(`${user.id}.bank`, (dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount));
                logger.log(`Removed ${(dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount)} ${CURRENCY_NAME} from ${user.username} (${user.id})'s bank.`);
                embed.setDescription(`Removed **${(dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount)}** ${CURRENCY_NAME} from **${user.username}**'s bank.`);
                await interaction.reply({embeds: [embed], ephemeral: true});
                user.send({embeds: [new EmbedBuilder()
                    .setAuthor({ name: `${interaction.user.username} has removed ${amount} ${CURRENCY_NAME} from your account in ${interaction.guild.name}!`, iconURL: user.displayAvatarURL({dynamic: true}) })
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 1024 }))
                    .setDescription(`You now have **${(dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount)}** ${CURRENCY_NAME} in your bank.\n\n*If you believe this is a mistake, please contact a server administrator.*`)
                    .setColor(randomHexColor())
                    .setTimestamp()
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                ]});
                break;
            case 'set':
                await db.set(`${user.id}.bank`, (amount < 0 ? 0 : amount));
                logger.log(`Set ${user.username} (${user.id})'s bank to ${(amount < 0 ? 0 : amount)} ${CURRENCY_NAME}.`);
                embed.setDescription(`Set **${user.username}**'s bank to **${(amount < 0 ? 0 : amount)}** ${CURRENCY_NAME}.`);
                await interaction.reply({embeds: [embed], ephemeral: true});
                user.send({embeds: [new EmbedBuilder()
                    .setAuthor({ name: `${interaction.user.username} has set your bank to ${amount} ${CURRENCY_NAME} in ${interaction.guild.name}!`, iconURL: user.displayAvatarURL({dynamic: true}) })
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 1024 }))
                    .setDescription(`You now have **${(amount < 0 ? 0 : amount)}** ${CURRENCY_NAME} in your bank.\n\n*If you believe this is a mistake, please contact a server administrator.*`)
                    .setColor(randomHexColor())
                    .setTimestamp()
                    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                ]});
                break;
        }
    },
};
