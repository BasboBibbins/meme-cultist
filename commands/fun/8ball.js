const {slashCommandBuilder, SlashCommandBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("8ball")
        .setDescription("Type your question, and have the both answer it for you...")
        .addStringOption(option =>
            option.setName('question')
                .setDescription('The question to ask the bot.')
                .setRequired(true)),

    async execute(interaction) {
        const eightball = [
            // affirmitive answers
            "It's certain bro.",
            "A definitive yes.",
            "Without a doubt. :ok_hand:",
            "A definite yes.",
            "You can rely on it.",
            "Yes.",
            "It'll probably happen.",
            "My sources say yes.",
            "The outlook is positive.",
            "All signs point to yes.",
            "We're so back.",
            // negative answers
            "No.",
            "Don't count on it.",
            "My sources say no.",
            "I doubt it.",
            "The outlook is very bad.",
            "Your mother will die in her sleep tonight.",
            "It's so over...",
            // non-committal answers
            "It's hazy... Try again later.",
            "Ask me later.",
            "It'd be better not to tell you now.",
            "I can't predict that at the moment. Sorry.",
            "You probably shouldn't rely on RNG for that."
          ]
          var rng = Math.floor(Math.random() * eightball.length)
          await interaction.reply(`:8ball: The magic 8ball says: **${eightball[rng]}** :8ball:`);
    },
};