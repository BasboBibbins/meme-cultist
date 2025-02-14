const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const { deleteDBUser, deleteDBValue, addNewDBUser, setDBValue } = require("../../database");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const logger = require("../../utils/logger");
const wait = require('util').promisify(setTimeout);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('db')
        .setDescription('[ADMIN] Manage database entries.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('[ADMIN] Add a new database entry.')
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
                .setDescription('[ADMIN] Delete a database entry.')
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
                .setDescription('[ADMIN] Set a database entry.')
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
                .setDescription('[ADMIN] Reset a database entry.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to reset all data from the database.')
                        .setRequired(true))),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const user = interaction.options.getUser('user');
        const key = interaction.options.getString('key');
        const value = interaction.options.getString('value');

        const error_embed = new EmbedBuilder()
            .setAuthor({ name: user.displayName , iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            error_embed.setDescription(`You do not have permission to use this command.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        if (user.bot) {
            error_embed.setDescription(`You cannot use this command on a bot.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        interaction.deferReply({ephemeral: true});
        await wait (1000);
        switch (subcommand) {
            case 'add':
                if (key && value) {
                    await setDBValue(user, key, value);
                    await interaction.editReply({content: `Added database entry for user ${user.username} (${user.id}) for key \`${key}\` with value \`${value}\`.`, ephemeral: true});
                    logger.log(`Added database entry for user ${user.username} (${user.id}) for key \`${key}\` with value \`${value}\`.`, 'info');
                } else {
                    await addNewDBUser(user);
                    await interaction.editReply({content: `Added database entry for user ${user.username} (${user.id}).`, ephemeral: true});
                    logger.log(`Added database entry for user ${user.username} (${user.id}).`, 'info');
                }
                break;
            case 'delete':
                if (key) {
                    await deleteDBValue(user, key);
                    await interaction.editReply({content: `Deleted database entry for user ${user.username} (${user.id}) for key \`${key}\`.`, ephemeral: true});
                    logger.log(`Deleted database entry for user ${user.username} (${user.id}) for key \`${key}\`.`, 'info');
                } else {
                    await deleteDBUser(user);
                    await interaction.editReply({content: `Deleted database entry for user ${user.username} (${user.id}).`, ephemeral: true});
                    logger.log(`Deleted database entry for user ${user.username} (${user.id}).`, 'info');
                }
                break;
            case 'set':
                await setDBValue(user, key, value);
                await interaction.editReply({content: `Set database entry for user ${user.username} (${user.id}) for key \`${key}\` to \`${value}\`.`, ephemeral: true});
                logger.log(`Set database entry for user ${user.username} (${user.id}) for key \`${key}\` to \`${value}\`.`, 'info');
                break;
            case 'reset':
                await deleteDBUser(user);
                await addNewDBUser(user);
                await interaction.editReply({content: `Reset database entry for user ${user.username} (${user.id}) to the default.`, ephemeral: true});
                logger.log(`Reset database entry for user ${user.username} (${user.id}) to the default.`, 'info');
                break;
        }
    },
};
