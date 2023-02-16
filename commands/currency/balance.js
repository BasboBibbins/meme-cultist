const {slashCommandBuilder, SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("balance")
        .setDescription("Check a users koku balance.")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to check the balance of.')
                .setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.log(`No database entry for user ${user.username} (${user.id}), creating one...`, "warn")
            await addNewDBUser(user);
        }
        const fetchedUser = await user.fetch()
        let accentColor = fetchedUser.hexAccentColor ? fetchedUser.hexAccentColor : "#FFFFFF";
        
        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username}'s Balance`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(`${accentColor}`)
            .addFields(
                { name: "Wallet", value: `${dbUser.balance} ${CURRENCY_NAME}`, inline: true },
                { name: "Bank", value: `${dbUser.bank} ${CURRENCY_NAME}`, inline: true },
            )
            .setTimestamp()
            .setFooter( interaction.options.getUser('user') ? 
                { text: `Requested by ${interaction.user.username}#${interaction.user.discriminator}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) } : 
                { text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})}
            );
        await interaction.reply({embeds: [embed]});
    },
};
