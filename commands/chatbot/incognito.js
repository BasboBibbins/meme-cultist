const { SlashCommandBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const usersDb = new QuickDB({ filePath: `./db/users.sqlite` });
const logger = require('../../utils/logger');
const { getUserChatbotData } = require('../../utils/openai');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('incognito')
    .setDescription('Toggle incognito mode for the chatbot.'),

  async execute(interaction) {
    const chatbot = await getUserChatbotData(interaction.user.id);
    chatbot.incognitoMode = !chatbot.incognitoMode;
    await usersDb.set(`${interaction.user.id}.chatbot`, chatbot);
    logger.debug(`User ${interaction.user.tag} has ${chatbot.incognitoMode ? 'enabled' : 'disabled'} incognito mode.`);
    await interaction.reply({ content: `Incognito mode is now ${chatbot.incognitoMode ? 'enabled' : 'disabled'}. The chatbot will ${chatbot.incognitoMode ? 'no longer ' : 'now '}learn from messages in this channel.`, ephemeral: true });
  }
};
