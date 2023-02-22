const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("choose")
        .setDescription("Choose between multiple options.")
        .addStringOption(option =>
            option.setName('options')
                .setDescription('The options to choose from.')
                .setRequired(true)),
    async execute(interaction) {
        let options = interaction.options.getString('options');
        if (options.includes(", ")) {
            options = options.split(", ");
        } else {
            options = options.split(" ");
        }
        const rng = Math.floor(Math.random() * options.length);
        if (options.length < 2) return interaction.reply({content: "You need to provide at least two options!", ephemeral: true});
        const prompt = [
            `I choose:`,
            `I pick:`,
            `I'm going with:`,
            `I'm going to go with:`,
            `I'm thinking`,
            `My choice is:`,
            `My guts tell me`,
            `Let's go with`,
            `It's gonna have to be`,
            `Personally, I perfer`,
            `I rigged the answer for ${interaction.user.username} to be:`,
            `I'm going to go with`,
            `:nerd: based on my calculations, it's`,
            `Number ${rng + 1} it is! `,
            `make the choice for yourself loser! kidding, it's`,
            `It came to me in a dream, it's`
        ]
        const promptrng = Math.floor(Math.random() * prompt.length);
        const embed = new EmbedBuilder()
            .setAuthor({name: `${prompt[promptrng]} '${options[rng]}.'`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
            .setColor(randomHexColor())
            .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`})
            .setTimestamp();
        await interaction.reply({embeds: [embed]});
    },
};