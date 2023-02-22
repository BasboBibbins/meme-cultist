const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("flip")
        .setDescription(`Flip a coin and win or lose ${CURRENCY_NAME}.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true)),
    async execute(interaction) {
        const option = interaction.options.getString('bet');
        const bet = await parseBet(option, interaction.user.id);
        const dbUser = await db.get(interaction.user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`)
            await addNewDBUser(interaction.user.id);
        }
        if (isNaN(bet)) {
            await interaction.reply(`You must flip a number of ${CURRENCY_NAME}!`);
            return;
        }
        if (bet % 1 != 0) {
            await interaction.reply(`You must flip a whole number of ${CURRENCY_NAME}!`);
            return;
        }
        if (bet < 1) {
            await interaction.reply(`You must flip at least 1 ${CURRENCY_NAME}!`);
            return;
        }
        if (bet > await db.get(`${interaction.user.id}.balance`)) {
            await interaction.reply(`You don't have enough ${CURRENCY_NAME}!`);
            return;
        }

        const chance = Math.floor(Math.random() * 100) + 1;

        const embed = new EmbedBuilder()
            .setAuthor({name: interaction.user.username+"#"+interaction.user.discriminator, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
            .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
            .setTimestamp();

        if (chance > 50) {
            embed.setColor(0x00FF00);
            embed.setTitle('Congratulations!')
            embed.setDescription(`You won **${bet}** ${CURRENCY_NAME}!\n\nYour new balance is **${(dbUser.balance + bet)}** ${CURRENCY_NAME}.`);
            await db.add(`${interaction.user.id}.balance`, bet);
            await db.add(`${interaction.user.id}.stats.flip.wins`, 1);
            if (bet > await db.get(`${interaction.user.id}.stats.flip.biggestWin`)) {
                await db.set(`${interaction.user.id}.stats.flip.biggestWin`, bet);
            }
            await interaction.reply({embeds: [embed]});
        } else {
            embed.setColor(0xFF0000);
            embed.setTitle('You lose!')
            embed.setDescription(`I'll be taking **${bet}** ${CURRENCY_NAME} from you.\n\nYour new balance is **${(dbUser.balance - bet)}** ${CURRENCY_NAME}. ${(dbUser.balance - bet) <= 0 ? `You're now broke!` : ''}`);
            await db.sub(`${interaction.user.id}.balance`, bet);
            await db.add(`${interaction.user.id}.stats.flip.losses`, 1);
            if (bet > await db.get(`${interaction.user.id}.stats.flip.biggestLoss`)) {
                await db.set(`${interaction.user.id}.stats.flip.biggestLoss`, bet);
            }
            await interaction.reply({embeds: [embed]});
        }
    }, 
};