const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("daily")
        .setDescription(`Claim your daily ${CURRENCY_NAME}.`),
    async execute(interaction) {
        const user = interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }

        const cooldown = 8.64e+7; // 24 hours
        const db_currentStreak = `${user.id}.stats.dailies.currentStreak`;
        const db_longestStreak = `${user.id}.stats.dailies.longestStreak`;

        if (dbUser.cooldowns.daily > Date.now()) {
            const timeLeft = new Date(dbUser.cooldowns.daily - Date.now());
            const embed = new EmbedBuilder()
                .setAuthor({name: user.username+"#"+user.discriminator, iconURL: user.displayAvatarURL({dynamic: true})})
                .setDescription(`You have already claimed your daily ${CURRENCY_NAME}! You can claim it again in **${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m ${timeLeft.getUTCSeconds()}s**.`)
                .setColor(0xFF0000)
                .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                .setTimestamp();
            return await interaction.reply({embeds: [embed]});
        }

        let streakprompt = ``;
        if (Date.now() - dbUser.cooldowns.daily > cooldown) {
            const currentStreak = await db.get(db_currentStreak);
            if (currentStreak > 1) streakprompt = `\nYou missed a day, so your streak of **${currentStreak}** has been reset!`;
            await db.set(db_currentStreak, 1);
        } else {
            await db.add(db_currentStreak, 1);
        }

        let streak = await db.get(db_currentStreak);
        streak = streak || 1;

        if (streak > dbUser.stats.dailies.longestStreak) await db.set(db_longestStreak, streak);

        const bonus = streak > 1?Math.floor(Math.random() * (streak * 10)) + 1:0;
        const amount = Math.floor(Math.random() * 100) + 100;
        await db.add(`${user.id}.balance`, amount + bonus);
        await db.add(`${user.id}.stats.dailies.claimed`, 1);
        await db.set(`${user.id}.cooldowns.daily`, Date.now() + cooldown);

        const embed = new EmbedBuilder()
            .setAuthor({name: user.username+"#"+user.discriminator, iconURL: user.displayAvatarURL({dynamic: true})})
            .setDescription(`You claimed your daily ${CURRENCY_NAME} and received **${(amount + bonus)}** ${CURRENCY_NAME}!${bonus>0?`\nYou also received a bonus for having a streak of **${streak}**!`:'' + streakprompt}`)
            .setColor(0x00FF00)
            .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
            .setTimestamp();
        await interaction.reply({embeds: [embed]});
        logger.log(`${user.username} (${user.id}) claimed their daily ${CURRENCY_NAME} and received ${amount + bonus} (${amount} + ${bonus}) ${CURRENCY_NAME}.\n\x1b[32m[INFO]\x1b[0m Current streak: ${streak} | Longest streak: ${await db.get(db_longestStreak)}`);
    },
};