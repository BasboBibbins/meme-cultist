const {SlashCommandBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");

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

        switch (subcommand) {
            case 'add':
                await db.set(`${user.id}.bank`, dbUser.bank + amount);
                logger.log(`Added ${amount} ${CURRENCY_NAME} to ${user.username} (${user.id})'s wallet.`);
                await interaction.reply({content: `Added **${amount}** ${CURRENCY_NAME} to **${user.username}**'s wallet.`, ephemeral: true});
                break;
            case 'remove':
                await db.set(`${user.id}.bank`, (dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount));
                logger.log(`Removed ${(dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount)} ${CURRENCY_NAME} from ${user.username} (${user.id})'s wallet.`);
                await interaction.reply({content: `Removed **${(dbUser.bank - amount) < 0 ? 0 : (dbUser.bank - amount)}** ${CURRENCY_NAME} from **${user.username}**'s wallet.`, ephemeral: true});
                break;
            case 'set':
                await db.set(`${user.id}.bank`, (amount < 0 ? 0 : amount));
                logger.log(`Set ${user.username} (${user.id})'s wallet to ${(amount < 0 ? 0 : amount)} ${CURRENCY_NAME}.`);
                await interaction.reply({content: `Set **${user.username}**'s wallet to **${(amount < 0 ? 0 : amount)}** ${CURRENCY_NAME}.`, ephemeral: true});
                break;
        }
    },
};
