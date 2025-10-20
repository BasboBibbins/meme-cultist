const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Refresh the chatroom, resetting the context of the bot.'),

  async execute(interaction) {
    const channelId = interaction.channel.id;
    const reply = await interaction.reply({
      content: '🧹 Context reset. The bot will ignore messages from before this point.',
      //fetchReply: true, 
    });
    client.contextResetPoints.set(channelId, reply.id); 

  }
};
