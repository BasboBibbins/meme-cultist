const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("daily")
        .setDescription(`Claim your daily ${CURRENCY_NAME}.`),
    async execute(interaction) {
        const user = interaction.user;
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            console.log(`\x1b[33m[WARN]\x1b[0m No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user.id);
        }
        const cooldown = 10000; // 8.64e+7 
        if (dbUser.cooldowns.daily > Date.now()) {
            const timeLeft = new Date(dbUser.cooldowns.daily - Date.now());
            return interaction.reply({content: `You have already claimed your daily ${CURRENCY_NAME}, please wait **${timeLeft.getUTCHours()}h ${timeLeft.getUTCMinutes()}m ${timeLeft.getUTCSeconds()}s** before claiming again.`, ephemeral: true});
        }

        const currentStreak = await db.get(`${user.id}.dailies.currentStreak`) || 0;

        const bonus = currentStreak > 0?Math.floor(currentStreak * 10) + 1:0;
        const amount = Math.floor(Math.random() * 100) + 1;
        dbUser.balance += amount + bonus;
        dbUser.cooldowns.daily = Date.now() + cooldown;
        await db.set(user.id, dbUser);
        const embed = new EmbedBuilder()
            .setAuthor({name: user.username+"#"+user.discriminator, iconURL: user.displayAvatarURL({dynamic: true})})
            .setDescription(`${currentStreak > 0?`You have claimed your daily ${CURRENCY_NAME} for **${currentStreak}** days in a row!\n`:``} You have received **${(amount + bonus)}** ${CURRENCY_NAME}!`)
            .setColor(0x00FF00)
            .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`})
            .setTimestamp();
        await interaction.reply({embeds: [embed]});
        await db.add(`${user.id}.dailies.currentStreak`, 1);
        if (currentStreak > db.get(`${user.id}.dailies.longestStreak`)) await db.set(`${user.id}.dailies.longestStreak`, currentStreak);
    },
};