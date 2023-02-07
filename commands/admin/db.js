const {SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const { deleteDBUser, deleteDBValue, addNewDBUser, setDBValue } = require("../../database");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('db')
        .setDescription('[ADMIN] Manage database entries.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new database entry.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to add to the database.')
                        .setRequired(true))
                        .addStringOption(option =>
                            option.setName('key')
                                .setDescription('The key to set. (Optional)')
                                .setRequired(false))
                        .addStringOption(option =>
                            option.setName('value')
                                .setDescription('The value to set. (Optional)')
                                .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a database entry.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to delete from the database.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('key')
                        .setDescription('The key to delete.')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set a database entry.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to set the database entry for.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('key')
                        .setDescription('The key to set.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('value')
                        .setDescription('The value to set.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset a database entry.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to reset all data from the database.')
                        .setRequired(true))),
    async execute(interaction) {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            await interaction.reply({content: `You do not have permission to use this command.`, ephemeral: true});
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const user = interaction.options.getUser('user');
        const key = interaction.options.getString('key');
        const value = interaction.options.getString('value');

        switch (subcommand) {
            case 'add':
                if (key && value) {
                    await setDBValue(user, key, value);
                    await interaction.reply({content: `Added database entry for user ${user.username} (${user.id}) for key \`${key}\` with value \`${value}\`.`, ephemeral: true});
                } else {
                    await addNewDBUser(user);
                    await interaction.reply({content: `Added database entry for user ${user.username} (${user.id}).`, ephemeral: true});
                }
                break;
            case 'delete':
                console.log(key)
                if (key) {
                    await deleteDBValue(user, key);
                    await interaction.reply({content: `Deleted database entry for user ${user.username} (${user.id}) for key \`${key}\`.`, ephemeral: true});
                } else {
                    await deleteDBUser(user);
                    await interaction.reply({content: `Deleted database entry for user ${user.username} (${user.id}).`, ephemeral: true});
                }
                break;
            case 'set':
                await setDBValue(user, key, value);
                await interaction.reply({content: `Set database entry for user ${user.username} (${user.id}) for key \`${key}\` to \`${value}\`.`, ephemeral: true});
                break;
            case 'reset':
                await deleteDBValue(user);
                await interaction.reply({content: `Reset database entry for user ${user.username} (${user.id}) to the default.`, ephemeral: true});
                break;
        }
    },
};
