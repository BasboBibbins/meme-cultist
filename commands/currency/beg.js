const { slashCommandBuilder, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

const { addNewDBUser } = require("../../database");

const { CURRENCY_NAME } = require("../../config.json");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("beg")
        .setDescription(`Beg for ${CURRENCY_NAME}.`),
    async execute(interaction) {
        const user = interaction.user;
        const dbUser = await db.get(interaction.user.id);
        const stats = `${user.id}.stats.begs`;
        if (!dbUser) {
            console.log(`\x1b[33m[WARN]\x1b[0m No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`)
            await addNewDBUser(interaction.user.id);
        }
        const amount = Math.floor(Math.random() * 100) + 1;
        const chance = Math.floor(Math.random() * 100) + 1;

        const fail_prompt = [
            `Try again later.`,
            `You're not going to get anything from me.`,
            `I don't have any ${CURRENCY_NAME}!`,
            `I'm not giving you any ${CURRENCY_NAME}!`,
            `Get a job!`,
            `I'm not your personal ATM!`,
            `Yeah, I'm thinking it's over for you.`,
            `S T F U`,

        ]

        if (dbUser.balance > 0) {
            await interaction.reply(`You already have ${CURRENCY_NAME}!`);
            return;
        }

        const embed = new EmbedBuilder()
            .setAuthor({name: interaction.user.username+"#"+interaction.user.discriminator, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
            .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
            .setTimestamp();
            
        if (chance > 75) {
            embed.setColor("#00ff00");
            embed.setDescription(`Fine, here's **${amount}** ${CURRENCY_NAME}. Now stop annoying me.`);
            await db.add(`${user.id}.balance`, amount);
            await console.log(`\x1b[32m[INFO]\x1b[0m Added ${amount} ${CURRENCY_NAME} to ${interaction.user.username} (${interaction.user.id})'s wallet.`);
            await db.add(`${stats}.wins`, 1);
            await interaction.reply({embeds: [embed]});
        } else {
            embed.setColor("#ff0000");
            embed.setDescription(fail_prompt[Math.floor(Math.random() * fail_prompt.length)]);
            await db.add(`${stats}.lossses`, 1);
            await interaction.reply({embeds: [embed]});
        }
        
    }
};
