const { SlashCommandBuilder } = require("discord.js");
const { updateThreadContext, getThreadContext } = require('../../utils/openai.js');
const { EmbedBuilder } = require("@discordjs/builders");
const { CHATBOT_CHANNEL } = require('../../config.json');
const logger = require('../../utils/logger.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('context')
    .setDescription('Manage chatbot context and features')
    .addSubcommand(subcommand => 
      subcommand
        .setName('set')
        .setDescription('Set chatbot context and features')
        .addStringOption(option => 
          option.setName('characteristics')
           .setDescription(`Set characteristics, e.g. "he has medium blonde hair with a thick beard"`)
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption(option => 
          option.setName('personality')
            .setDescription('Set personality of the chatbot, e.g. "he is very outgoing and friendly"')
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption(option => 
          option.setName('preferences')
            .setDescription('What the bot prefers, e.g. "he likes to talk about his favorite color"')
            .setRequired(false)
            .setMaxLength(256)
        )
        .addStringOption(option => 
          option.setName('dialog')
            .setDescription('Modify the dialog style, e.g. sincere, friendly, casual')
            .setRequired(false)
            .setMaxLength(64)
        )
        .addStringOption(option => 
          option.setName('boundaries')
            .setDescription('Set boundaries, e.g. no humor, no markdown')
            .setRequired(false)
            .setMaxLength(128)
        )
        .addStringOption(option => 
          option.setName('topic')
            .setDescription('Set the topic of the conversation, e.g. "programming"')
            .setRequired(false)
            .setMaxLength(256)
        ),
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('get')
        .setDescription('Set chatbot context and features')
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('summaries')
        .setDescription('List the current thread summaries')
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('reset')
        .setDescription('Reset all chatbot context and features')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const thread = interaction.client.channels.cache.get(interaction.channelId)

    let embed = new EmbedBuilder()
    .setAuthor({ name: `Chatbot Context`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp()
    .setColor(0xFF0000)
    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
    if (!thread.isThread() || thread.parentId != CHATBOT_CHANNEL) {
      embed.setDescription('Please run this command in a thread!');
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    const threadContext = await getThreadContext(thread);
    const { characteristics, personality, preferences, dialog, boundaries } = threadContext.roleplay_options;
    const { topic, summaries } = threadContext;
    switch (subcommand) {
      case 'get':
        // Get the current context for the thread.
        embed 
          .setAuthor({ name: `Current Chatbot Context`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`
            Characteristics: **${characteristics != '' ? characteristics : '*None*'}**
            Personality: **${personality != '' ? personality : '*None*'}**
            Preference: **${preferences != '' ? preferences : '*None*'}**
            Dialog: **${dialog != '' ? dialog : '*None*'}**
            Boundaries: **${boundaries != '' ? boundaries : '*None*'}**
            Topic: **${topic != '' ? topic : '*None*'}**
            Summaries: **${summaries.length > 0 ? summaries.length : '*None*'}**
            `)
          .setColor(0x007bff);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        logger.debug(`Thread Context:${JSON.stringify(threadContext)}`)
        break;
      case 'set':
        // Set the current context for the thread.
        const characteristicValue = interaction.options.getString('characteristics') || characteristics;
        const personalityValue = interaction.options.getString('personality') || personality;
        const preferenceValue = interaction.options.getString('preferences') || preferences;
        const dialogValue = interaction.options.getString('dialog') || dialog;
        const boundariesValue = interaction.options.getString('boundaries') || boundaries;
        const topicValue = interaction.options.getString('topic') || topic;
        const updatedContext = { // updated values or default values
          roleplay_options: {
            characteristics: characteristicValue,
            personality: personalityValue,
            preferences: preferenceValue,
            dialog: dialogValue,
            boundaries: boundariesValue
          },
          topic: topicValue
        };
        await updateThreadContext(thread, updatedContext);
        embed
          .setAuthor({ name: `Chatbot Context Updated`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`
            Characteristics: **${characteristicValue != '' ? characteristicValue : '*No Changes*'}**
            Personality: **${personalityValue != '' ? personalityValue : '*No Changes*'}**
            Preferences: **${preferenceValue != '' ? preferenceValue : '*No Changes*'}**
            Dialog: **${dialogValue != '' ? dialogValue : '*No Changes*'}**
            Boundaries: **${boundariesValue != '' ? boundariesValue : '*No Changes*'}**
            Topic: **${topicValue != '' ? topicValue : '*No Changes*'}**`
          )
          .setColor(0xF9844A);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;  
      case 'reset':
        const blankContext = {
          roleplay_options: {
            characteristics: '',
            personality: '',
            preferences: '',
            dialog: '',
            boundaries: ''
          },
          topic: '',
        };
        await updateThreadContext(thread, blankContext);
        embed
          .setAuthor({ name: `Chatbot Context Reset`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`Successfully reset chatbot context.`)
          .setColor(0xF9844A);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      case 'summaries':
        const latestSummary = summaries[summaries.length - 1];
        const output = latestSummary // TODO: change to show multiple summaries if there is space
        embed
         .setAuthor({ name: `Chatbot Summaries`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
         .setDescription(`${summaries.length > 0 ? output : `No summaries found for thread "${thread.name}"`}`)
         .setColor(0xF9844A);
         await interaction.reply({ embeds: [embed], ephemeral: true });
         break;
      default:
        await interaction.reply({
          content: 'Invalid command',
          ephemeral: true,
        });
        break;
    }
  },
};