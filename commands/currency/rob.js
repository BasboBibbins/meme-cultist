const { SlashCommandBuilder, EmbedBuilder } = require("discord.js")
const { QuickDB } = require("quick.db")
const db = new QuickDB({ filePath: "./db/users.sqlite" })
const { addNewDBUser } = require("../../database")
const { CURRENCY_NAME } = require("../../config.json")
const logger = require("../../utils/logger")

module.exports = {
    data: new SlashCommandBuilder()
        .setName("rob")
        .setDescription(`Rob a user of their ${CURRENCY_NAME}!`)
        .addUserOption(option =>
            option.setName("user")
                .setDescription("The user to rob.")
                .setRequired(true)),
    async execute(interaction) {
        const victim = interaction.options.getUser("user");
        const user = interaction.user;
        const dbUser = await db.get(victim.id);

        const error_embed = new EmbedBuilder()
            .setAuthor({ name: user.username + "#" + user.discriminator, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setColor(0xFF0000)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        
        if (!dbUser) {
            logger.log(`No database entry for user ${victim.username} (${victim.id}), creating one...`, "warn")
            await addNewDBUser(victim);
        }
        
        if (victim.bot) {
            error_embed.setDescription(`You can't rob a bot!`);
            return await interaction.reply({ embeds: [error_embed], ephemeral: true });
        }

        if (victim.id === user.id) {
            error_embed.setDescription(`You can't rob yourself!`);
            return await interaction.reply({ embeds: [error_embed], ephemeral: true });
        }

        if (dbUser.balance < 1) {
            error_embed.setDescription(`This user doesn't have any ${CURRENCY_NAME} to rob!`);
            return await interaction.reply({ embeds: [error_embed], ephemeral: true });
        }

        const amount = Math.floor(Math.random() * dbUser.balance) + 1;
        const chance = Math.floor(Math.random() * 100) + 1;
        const cooldown = 60000;

        if (await db.get(`${user.id}.cooldowns.rob`) > Date.now()) {
            const timeLeft = new Date(dbUser.cooldowns.rob - Date.now());
            const embed = new EmbedBuilder()
                .setAuthor({ name: user.username + "#" + user.discriminator, iconURL: user.displayAvatarURL({ dynamic: true }) })
                .setDescription(`You have already attempted to rob someone recently! You can rob again in **${timeLeft.getUTCSeconds() ? timeLeft.getUTCSeconds() : `60`}s**.`)
                .setColor(0xFF0000)
                .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
            return await interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${user.username} is attempting to rob ${victim.username}!`, iconURL: user.displayAvatarURL({ dynamic: true }) })
            .setThumbnail(victim.displayAvatarURL({ dynamic: true, size: 1024 }))
            .setTimestamp()
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
        await interaction.deferReply();

        logger.debug(`chance > 75: ${chance > 75} | chance: ${chance} | amount: ${amount} | victim: ${victim.username} (${victim.id}) | user: ${user.username} (${user.id})`)

        if (chance > 75) { 
            await db.add(`${user.id}.balance`, amount);
            await db.sub(`${victim.id}.balance`, amount);
            embed.setColor("#00ff00");
            embed.setDescription(`${user.username} has successfully robbed **${amount}** ${CURRENCY_NAME} from ${victim.username}!`);
            await interaction.editReply({ embeds: [embed] });
            await victim.send({ embeds: [new EmbedBuilder()
                .setTitle("Oh no!")
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
                .setDescription(`**${user.username}** just robbed you of **${amount}** ${CURRENCY_NAME} in ${interaction.guild.name}!\n\nBe sure to keep your ${CURRENCY_NAME} safe by depositing it into your bank next time!`)
                .setColor("#ff0000")
                .setTimestamp()
                .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })] });
        } else {
            embed.setColor("#ff0000");
            embed.setDescription(`${user.username} failed to rob ${victim.username}!`);
            await interaction.editReply({ embeds: [embed] });
        }
        return await db.set(`${user.id}.cooldowns.rob`, Date.now() + cooldown);
    },
};
