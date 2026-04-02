const { SlashCommandBuilder } = require('discord.js');
const { updateChannelContext } = require('../../utils/openai.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Refresh the chatroom, resetting the context of the bot.'),

  async execute(interaction) {
    const channelId = interaction.channel.id;
    const reply = await interaction.reply({
      content: '🧹 Context reset. The bot will ignore messages from before this point.',
      fetchReply: true,
    });
    await updateChannelContext(interaction.channel, { resetPoint: reply.id });
    interaction.client.contextResetPoints.set(channelId, reply.id);
  }
};
