const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rate')
        .setDescription('Rate something!')
        .addStringOption(option =>
            option.setName('input')
                .setDescription('The thing to rate')
                .setRequired(true)),
    async execute(interaction) {
        let input = interaction.options.getString('input');
        let rating = Math.floor(Math.random() * 10) + 1;
        const rate_prompts = [
            `I rate ****${input}**** a ****${rating}/10****!`,
            `I'd give **${input}** a **${rating}/10**!`,
            `I'm thinking **${rating}/10** for **${input}**!`,
            `Sure, I'll give **${input}** a **${rating}/10**!`,
            `Gonna have to give **${input}** a **${rating}/10**.`,
            `If I had to rate **${input}**, I'd give it a **${rating}/10**.`,
            `Now, I'm not saying **${input}** is bad, but I'd give it a **${rating}/10**.`,
            `**${input}** is a **${rating}/10**!`,
            `**${input}** is clearly a **${rating}/10**.`,
            `Easy **${rating}/10** for **${input}**.`,
            `I'd rate **${input}** a high **${rating-1}**, maybe low **${rating}/10**.`,
            `I'd give **${input}** a **${rating}/10**, but I'm biased.`,
            `I'd give **${input}** a **${rating}/10**, but I'm not biased.`,
            `Based on facts and logic, I'd give **${input}** a **${rating}/10**.`,
            `Survey says: **${rating}/10** for **${input}**!`,
            `Not gonna lie, **${input}** is a **${rating}/10**.`,
        ];
        const rate_prompt = rate_prompts[Math.floor(Math.random() * rate_prompts.length)];
            
        const embed = new EmbedBuilder()
            .setAuthor({ name: `Requested by ${interaction.user.username}#${interaction.user.discriminator}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setColor(randomHexColor())
            .setDescription(rate_prompt)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        await interaction.reply({ embeds: [embed] });
    },
};