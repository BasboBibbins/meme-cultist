const { SlashCommandBuilder, EmbedBuilder } = require("discord.js")
const { QuickDB } = require("quick.db")
const db = new QuickDB({ filePath: `./db/users.sqlite` })
const { addNewDBUser } = require("../../database")
const { CURRENCY_NAME } = require("../../config.json")
const { parseBet } = require("../../utils/betparse")
const logger = require("../../utils/logger")
const { randomHexColor } = require("../../utils/randomcolor")

module.exports = {
    data: new SlashCommandBuilder()
        .setName("give")
        .setDescription(`Give ${CURRENCY_NAME} to another user.`)
        .addUserOption(option => option.setName("user").setDescription("The user to give the currency to.").setRequired(true))
        .addStringOption(option => option.setName("amount").setDescription("The amount of currency to give.").setRequired(true)),
    async execute(interaction) {
        const sender = interaction.user;
        const receiver = interaction.options.getUser("user");
        const amount = await parseBet(interaction.options.getString("amount"), sender.id);
        const dbSender = await db.get(sender.id);
        const dbReceiver = await db.get(receiver.id);
        const ephemeral_embed = new EmbedBuilder()
            .setAuthor({ name: `Error!`, iconURL: sender.displayAvatarURL({ dynamic: true }) })
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setTimestamp();
        if (!dbSender) {
            logger.warn(`No database entry for user ${sender.username} (${sender.id}), creating one...`, "warn")
            await addNewDBUser(sender);
        }
        if (!dbReceiver) {
            logger.warn(`No database entry for user ${receiver.username} (${receiver.id}), creating one...`, "warn")
            await addNewDBUser(receiver);
        }
        if (receiver.bot) {
            ephemeral_embed.setDescription(`You can't give ${CURRENCY_NAME} to a bot!`);
            return await interaction.reply({ embeds: [ephemeral_embed], ephemeral: true });
        }
        if (sender.id === receiver.id) {
            ephemeral_embed.setDescription(`You can't give ${CURRENCY_NAME} to yourself!`);
            return await interaction.reply({ embeds: [ephemeral_embed], ephemeral: true });
        }
        if (amount > dbSender.balance) {
            ephemeral_embed.setDescription(`You don't have enough ${CURRENCY_NAME} to give!`);
            return await interaction.reply({ embeds: [ephemeral_embed], ephemeral: true });
        }
        if (amount < 1) {
            ephemeral_embed.setDescription(`You can't give less than 1 ${CURRENCY_NAME}!`);
            return await interaction.reply({ embeds: [ephemeral_embed], ephemeral: true });
        }
        await db.sub(`${sender.id}.balance`, amount);
        await db.add(`${receiver.id}.balance`, amount);
        ephemeral_embed
            .setAuthor({ name: `You sent ${amount} ${CURRENCY_NAME} to ${receiver.displayName}!`, iconURL: sender.displayAvatarURL({ dynamic: true }) })
            .setThumbnail(receiver.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(`You now have **${dbSender.balance - amount}** ${CURRENCY_NAME} in your wallet!`)
            .setColor(0x00FF00)
        await interaction.reply({ embeds: [ephemeral_embed], ephemeral: true });
        const dm_embed = new EmbedBuilder()
            .setAuthor({ name: `You received ${amount} ${CURRENCY_NAME} from ${sender.displayName}!`, iconURL: receiver.displayAvatarURL({ dynamic: true }) })
            .setThumbnail(sender.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setDescription(`You now have **${dbReceiver.balance + amount}** ${CURRENCY_NAME} in your wallet!`)
            .setColor(randomHexColor())
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        await receiver.send({ embeds: [dm_embed] });
    }
}


