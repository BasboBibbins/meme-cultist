const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { CURRENCY_NAME } = require("../../config.json");
const { getAllTimeTopUsers, getCurrentTopUsers } = require("../../utils/bank");
const logger = require("../../utils/logger");
const { randomHexColor } = require("../../utils/randomcolor");
const wait = require('node:timers/promises').setTimeout;

async function getTopUsers(type) {
    const users = await db.all();
    for (const user of users) {
        user.balance = await db.get(`${user.id}.balance`);
        user.bank = await db.get(`${user.id}.bank`);

        if (!user.balance) {
            user.balance = 0;
        }

        if (!user.bank) {
            user.bank = 0;
        }
    }

    const walletTop = users.sort((a, b) => b.balance - a.balance).slice(0, 10);
    const bankTop = users.sort((a, b) => b.bank - a.bank).slice(0, 10);

    if (type === "wallet") {
        logger.debug(`walletTop: ${walletTop.map(user => `${user.id} - ${user.balance}`).join(", ")}`);
        return walletTop;
    } else if (type === "bank") {
        logger.debug(`bankTop: ${bankTop.map(user => `${user.id} - ${user.bank}`).join(", ")}`);
        return bankTop;
    } else {
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription(`View the top 10 users in the server!`),
    async execute(interaction) {
        await interaction.deferReply();
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by ${interaction.user.displayName }`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

                    
        const current = await getCurrentTopUsers();
        const allTime = await getAllTimeTopUsers();
        await wait (500); // Wait for the database to update
        
        embed.setTitle(`Leaderboard for ${interaction.guild.name}`);
        embed.addFields(
            { name: "Current Top 10 Banks", value: current.map((user, index) => `${index + 1}. <@${user.id}> - ${user.value.bank} ${CURRENCY_NAME}`).join("\n"), inline: true },
            { name: "All Time Top 10 Banks", value: allTime.map((user, index) => `${index + 1}. <@${user.id}> - ${user.value.stats.largestBank} ${CURRENCY_NAME}`).join("\n"), inline: true }
        );
        await interaction.editReply({ embeds: [embed] });
        await wait(60000).then(async () => {
            interaction.deleteReply();
        }).catch((err) => {
            logger.error(`Failed to delete reply for command ${interaction.commandName}`);
            logger.error(err);
        });
    }
};
