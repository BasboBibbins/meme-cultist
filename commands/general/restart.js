const {EmbedBuilder, SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle} = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("restart")
        .setDescription("[ADMIN] Restart the bot."),
    async execute(interaction) {

        // if user is not an admin, return
        if (!interaction.member.permissions.has("ADMINISTRATOR")) {
            return await interaction.reply({content: "You do not have permission to use this command.", ephemeral: true});
        }

        const embed = new EmbedBuilder()
            .setTitle(":warning: WARNING :warning:")
            .setDescription("Are you sure you want to restart the bot? This will cause the bot to go offline for a few seconds.")
            .setColor(0x00AE86)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) })
            .setTimestamp();
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId("restart")
                    .setLabel("Restart")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Danger),
            );
        await interaction.reply({embeds: [embed], components: [row], ephemeral: true});

        const filter = i => i.customId === "restart" || i.customId === "cancel";
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

        collector.on('collect', async i => {
            if (i.customId === "restart") {
                embed.setDescription("Restarting...");
                await i.update({embeds: [embed], components: [], ephemeral: true});
                process.exit(0);
                
            } else if (i.customId === "cancel") {
                embed.setDescription("Restart cancelled.");
                await i.update({embeds: [embed], components: [], ephemeral: true});
            }
            collector.stop();
        });
        
        collector.on('end', async (collected, reason) => {
            logger.debug(`Restart collector has ended. Collected ${collected.size} interactions. Reason: ${reason}`)
            if (reason === "time") {
                await interaction.editReply({content: "Restart cancelled due to inactivity.", components: [], ephemeral: true});
            }
        });
    },
};