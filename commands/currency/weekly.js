const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");

const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("weekly")
        .setDescription(`Claim your weekly ${CURRENCY_NAME}.`),
        async execute(interaction) {
            const user = interaction.user;
            const dbUser = await db.get(user.id);
            logger.log(`dbUser: ${dbUser} (type: ${typeof dbUser})`)
            if (!dbUser) {
                logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
                await addNewDBUser(user);
            }
    
            const cooldown = 6.048e+8; // 7 days
    
            if (dbUser.cooldowns.weekly > Date.now()) {
                const timeLeft = new Date(dbUser.cooldowns.weekly - Date.now());
                const oneDay = 8.64e+7;
                const getDays = Math.floor(timeLeft / oneDay);
                const embed = new EmbedBuilder()
                    .setAuthor({name: user.displayName , iconURL: user.displayAvatarURL({dynamic: true})})
                    .setDescription(`You have already claimed your weekly ${CURRENCY_NAME}! You can claim again in **${getDays}d ${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m ${timeLeft.getUTCSeconds()}s**.`)
                    .setColor(0xFF0000)
                    .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                    .setTimestamp();
                return await interaction.reply({embeds: [embed]});
            }

            const amount = Math.floor(Math.random() * 500) + 500;
            await db.add(`${user.id}.bank`, amount);
            await db.add(`${user.id}.stats.weeklies.claimed`, 1);
            await db.set(`${user.id}.cooldowns.weekly`, Date.now() + cooldown);

            const embed = new EmbedBuilder()
                .setAuthor({name: user.displayName , iconURL: user.displayAvatarURL({dynamic: true})})
                .setDescription(`You have claimed your weekly ${CURRENCY_NAME}! **${amount}** ${CURRENCY_NAME} has been added to your bank.`)
                .setColor(0x00FF00)
                .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                .setTimestamp();
            await interaction.reply({embeds: [embed]});
            logger.log(`${user.username} (${user.id}) claimed their weekly ${CURRENCY_NAME} and received ${amount} ${CURRENCY_NAME}.`)
        }
};