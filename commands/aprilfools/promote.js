const {SlashCommandBuilder, EmbedBuilder, InteractionType} = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("promote")
        .setDescription(`Buy a rank promotion for ${CURRENCY_NAME}.`)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to promote.')
                .setRequired(false)),
    async execute(interaction) {
        const listofranks = [
            { name: "Peasant", cost: 0 },
            { name: "Meme Employee", cost: 500 },
            { name: "Meme Team Lead", cost: 1000 },
            { name: "Meme Supervisor", cost: 2000 },
            { name: "Meme Manager", cost: 5000 },
            { name: "Meme Vice President", cost: 10000 },
            { name: "Meme President", cost: 20000 },
            { name: "Meme CEO", cost: 50000 }
        ];
        const user = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id);

        const dbUser = await db.get(interaction.user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`, "warn")
            await addNewDBUser(interaction.user);
        }

        const error_embed = new EmbedBuilder()
            .setAuthor({ name: interaction.user.username + "#" + interaction.user.discriminator, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        if (user.bot) {
            error_embed.setDescription(`**${user.username}** is a bot, and therefore cannot be promoted.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        const currentRank = listofranks.find(rank => member.roles.cache.find(role => role.name === rank.name));
        console.log(currentRank);
        if (!currentRank) {
            error_embed.setDescription(`**${user.username}** does not have a rank.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }
        const nextRank = listofranks[listofranks.indexOf(currentRank) + 1];
        if (!nextRank) {
            error_embed.setDescription(`**${user.username}** is already at the highest rank. They have won the game of life!`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        if (dbUser.balance < nextRank.cost) {
            error_embed.setDescription(`You do not have enough ${CURRENCY_NAME} to promote ${user == interaction.user ? "yourself" : user.username} to **${nextRank.name}**.\nYou need ${nextRank.cost - dbUser.balance} more ${CURRENCY_NAME}.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: user.username + "#" + user.discriminator, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        console.log(interaction.guild.roles.cache);
        logger.debug(currentRank.name);
        await member.roles.remove(interaction.guild.roles.cache.find(role => role.name === currentRank.name));
        await member.roles.add(interaction.guild.roles.cache.find(role => role.name === nextRank.name));

        const success = member.roles.cache.find(role => role.name === nextRank.name);
        if (!success) {
            error_embed.setDescription(`There was an error promoting ${user == interaction.user ? "yourself" : user.username} to **${nextRank.name}**.`);
            return await interaction.reply({embeds: [error_embed], ephemeral: true});
        } else {
            await db.sub(`${interaction.user.id}.balance`, nextRank.cost);
            embed.setDescription(`${user.username} has sucessfully been promoted to **${nextRank.name}** ${user != interaction.user ? `thanks to ${interaction.user.username}'s generosity` : ""}!`);
            await interaction.reply({embeds: [embed]});
        }
    }

}
