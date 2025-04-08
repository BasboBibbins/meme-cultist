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
            .setMaxLength(1024)
        )
        .addStringOption(option => 
          option.setName('personality')
            .setDescription('Set personality of the chatbot, e.g. "he is very outgoing and friendly"')
            .setRequired(false)
            .setMaxLength(1024)
        )
        .addStringOption(option => 
          option.setName('preferences')
            .setDescription('What the bot prefers, e.g. "he likes to talk about his favorite color"')
            .setRequired(false)
            .setMaxLength(1024)
        )
        .addStringOption(option => 
          option.setName('dialog')
            .setDescription('Modify the dialog style, e.g. sincere, friendly, casual')
            .setRequired(false)
            .setMaxLength(128)
        )
        .addStringOption(option => 
          option.setName('boundaries')
            .setDescription('Set boundaries, e.g. no humor, no markdown')
            .setRequired(false)
            .setMaxLength(512)
        )
        .addStringOption(option => 
          option.setName('topic')
            .setDescription('Set the topic of the conversation, e.g. "programming"')
            .setRequired(false)
            .setMaxLength(1024)
        ),
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('get')
        .setDescription('Set chatbot context and features')
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('summary')
        .setDescription('View an AI generated summary of the current thread.')
        .addIntegerOption(option => 
          option.setName('number')
            .setDescription('The number of the summary to view. Default: Latest')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('reset')
        .setDescription('Reset all chatbot context and features')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const thread = interaction.client.channels.cache.get(interaction.channelId)

    let list; let desc;
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
    console.log(threadContext);
    const { characteristics, personality, preferences, dialog, boundaries } = threadContext.roleplay_options;
    const { topic, summaries, facts, embeddingChunks } = threadContext;
    switch (subcommand) {
      case 'get':
        list = [
          characteristics != '' && `**Characteristics:** ${characteristics}`,
          personality != '' && `**Personality:** ${personality}`,
          preferences != '' && `**Preference:** ${preferences}`,
          dialog != '' && `**Dialog:** ${dialog}`,
          boundaries != '' && `**Boundaries:** ${boundaries}`,
          topic != '' && `**Topic:** ${topic}`,
          summaries.length > 0 && `**Summaries:** ${summaries.length}`,
          facts && `**Facts:** ${facts.length}`
        ]
        desc = list.filter(Boolean).join('\n')
        embed 
          .setAuthor({ name: `Current Chatbot Context`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(desc)
          .setColor(0x007bff);
        await interaction.reply({ embeds: [embed], ephemeral: true });
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
        list = [
          characteristicValue != '' && `Characteristics: ${characteristicValue}`,
          personalityValue !== '' && `Personality: ${personalityValue}`,
          preferenceValue !== '' && `Preferences: ${preferenceValue}`,
          dialogValue !== '' && `Dialog: ${dialogValue}`,
          boundariesValue !== '' && `Boundaries: ${boundariesValue}`,
          topicValue !== '' && `Topic: ${topicValue}`,
        ]
        desc = list.filter(Boolean).join('\n');
        embed
          .setAuthor({ name: `Chatbot Context Updated`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(desc)
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
          facts: [],
        };
        await updateThreadContext(thread, blankContext);
        embed
          .setAuthor({ name: `Chatbot Context Reset`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`Successfully reset chatbot context.`)
          .setColor(0xF9844A);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      case 'summary':
        const n = interaction.options.getInteger("number") || summaries.length;
        logger.debug(`n: ${n} | summaries.length: ${summaries.length}`)
        const chosenSummary = summaries[n-1];
        if (n < 0 || n > summaries.length) {
          embed
          .setAuthor({ name: `Error`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`Invalid summary number, please choose a number between 1 and ${summaries.length}.`)
          .setColor(0xF9844A);
          return await interaction.reply({
            content: `Invalid summary number, please choose a number between 1 and ${summaries.length}.`,
            ephemeral: true,
          });
        }
        list = [
          chosenSummary && `**Summary:**\n${chosenSummary.context}`,
          chosenSummary.messagesIncluded && `**Messages used:** ${chosenSummary.messagesIncluded.map((m, i) => `${i+1}: ${m.content.length > 128 ? m.content.substring(0, 128)+`...` : m.content}`).join('\n')}`,
          chosenSummary.mergedFrom && `**Previous summaries used:** ${chosenSummary.mergedFrom}`,
          chosenSummary.timestamp && `**Generated on ${new Date(chosenSummary.timestamp).toLocaleString()}**`
        ]
        desc = list.filter(Boolean).join('\n');
        embed
         .setAuthor({ name: `Chatbot Summary (#${n} of ${summaries.length})`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
         .setDescription(desc)
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