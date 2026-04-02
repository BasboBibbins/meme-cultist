const { SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const usersDb = new QuickDB({ filePath: `./db/users.sqlite` });
const logger = require('../../utils/logger');
const { getUserChatbotData } = require('../../utils/openai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('incognito')
    .setDescription('Toggle incognito mode for the chatbot.')
    .addStringOption(option =>
      option
        .setName('scope')
        .setDescription('Whether to toggle global or channel-specific incognito. Default: channel.')
        .addChoices(
          { name: 'channel', value: 'channel' },
          { name: 'global', value: 'global' },
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const channelId = interaction.channel.id;
    const scope = interaction.options.getString('scope') || 'channel';
    const chatbot = await getUserChatbotData(userId);

    if (scope === 'global') {
      chatbot.incognitoMode = !chatbot.incognitoMode;
      await usersDb.set(`${userId}.chatbot`, chatbot);
      logger.debug(`User ${interaction.user.tag} has ${chatbot.incognitoMode ? 'enabled' : 'disabled'} GLOBAL incognito mode.`);
      await interaction.reply({
        content: `Global incognito mode is now ${chatbot.incognitoMode ? 'enabled' : 'disabled'}. The chatbot will ${chatbot.incognitoMode ? 'no longer ' : 'now '}learn from your messages in any channel or thread.`,
        ephemeral: true,
      });
      return;
    }

    const incognitoChannels = Array.isArray(chatbot.incognitoChannels) ? chatbot.incognitoChannels : [];
    const index = incognitoChannels.indexOf(channelId);

    let enabled;
    if (index === -1) {
      incognitoChannels.push(channelId);
      enabled = true;
    } else {
      incognitoChannels.splice(index, 1);
      enabled = false;
    }

    chatbot.incognitoChannels = incognitoChannels;
    await usersDb.set(`${userId}.chatbot`, chatbot);

    logger.debug(`User ${interaction.user.tag} has ${enabled ? 'enabled' : 'disabled'} incognito mode in channel ${channelId}.`);
    await interaction.reply({
      content: `Channel incognito mode is now ${enabled ? 'enabled' : 'disabled'} for **${interaction.channel.name}**. The chatbot will ${enabled ? 'no longer ' : 'now '}learn from your messages here.${chatbot.incognitoMode ? ' (Global incognito is also enabled, so user memory is fully disabled.)' : ''}`,
      ephemeral: true,
    });
  }
};
