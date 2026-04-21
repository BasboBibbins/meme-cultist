const { SlashCommandBuilder } = require("discord.js");
const { updateThreadContext, getThreadContext, getUserChatbotData } = require('../../utils/openai.js');
const { EmbedBuilder } = require("@discordjs/builders");
const logger = require('../../utils/logger.js');

const SCOPE_CHOICES = [
  { name: 'Channel', value: 'channel' },
  { name: 'User', value: 'user' },
];

const FIELDS_PER_PAGE = 25;
const SUMMARIES_PER_PAGE = 5;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('context')
    .setDescription(`Allows you to view and manage various chatbot features within channels and threads.`)
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Modify various settings, including the topic and roleplaying variables.')
        .addStringOption(option => 
          option.setName('characteristics')
           .setDescription(`[RP] Set characteristics, e.g. "he has medium blonde hair with a thick beard"`)
            .setRequired(false)
            .setMaxLength(1024)
        )
        .addStringOption(option => 
          option.setName('personality')
            .setDescription('[RP] Set personality of the chatbot, e.g. "he is very outgoing and friendly"')
            .setRequired(false)
            .setMaxLength(1024)
        )
        .addStringOption(option => 
          option.setName('preferences')
            .setDescription('[RP] What the bot prefers, e.g. "he likes to talk about his favorite color"')
            .setRequired(false)
            .setMaxLength(1024)
        )
        .addStringOption(option => 
          option.setName('dialog')
            .setDescription('[RP] Modify the dialog style, e.g. sincere, friendly, casual')
            .setRequired(false)
            .setMaxLength(128)
        )
        .addStringOption(option => 
          option.setName('boundaries')
            .setDescription('[RP] Set boundaries, e.g. no humor, no markdown')
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
        .setDescription(`View the current channel's context data and variables`)
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('summary')
        .setDescription('View AI generated summaries.')
        .addStringOption(option =>
          option.setName('scope')
            .setDescription('View channel or user summaries. Default: Channel')
            .setRequired(false)
            .addChoices(...SCOPE_CHOICES)
        )
        .addIntegerOption(option =>
          option.setName('page')
            .setDescription('The page number to view (5 summaries per page). Default: 1')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('facts')
        .setDescription('Display a table of saved facts.')
        .addStringOption(option =>
          option.setName('scope')
            .setDescription('View channel or user facts. Default: Channel')
            .setRequired(false)
            .addChoices(...SCOPE_CHOICES)
        )
        .addIntegerOption(option =>
          option.setName('page')
            .setDescription('The page number to view (25 facts per page). Default: 1')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(subcommand => 
      subcommand
        .setName('reset')
        .setDescription(`Reset the current channel's context to default.`)
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channel = interaction.client.channels.cache.get(interaction.channelId)

    let list; let desc;
    let embed = new EmbedBuilder()
    .setAuthor({ name: `Chatbot Context`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp()
    .setColor(0xFF0000)
    .setFooter({ text: `${interaction.client.user.username} | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) });
    const threadContext = await getThreadContext(channel);
    const { characteristics, personality, preferences, dialog, boundaries } = threadContext.roleplay_options;
    const { topic, summaries, facts } = threadContext;
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
          facts && `**Facts:** ${facts.length}`,
          summaries.length > 0 && `**Last Summary At:** ${new Date(summaries[summaries.length - 1].timestamp).toLocaleString()}`,
          facts && facts.length > 0 && facts[0].updatedAt && `**Last Facts Update:** ${new Date(facts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].updatedAt).toLocaleString()}`
        ]
        desc = list.filter(Boolean).join('\n')
        embed 
          .setAuthor({ name: `Current Chatbot Context`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(desc)
          .setColor(0x007bff);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      case 'set':
        // Permission check: only admins can modify channel context
        // Users in threads can modify their own thread's context
        if (!interaction.channel.isThread() && !interaction.member.permissions.has('ManageChannels')) {
          embed
            .setAuthor({ name: `Permission Denied`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setDescription('Only server administrators can modify channel context. Create a thread to customize the bot in your own space!')
            .setColor(0xFF0000);
          return await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (interaction.channel.isThread() && interaction.channel.ownerId !== interaction.user.id && !interaction.member.permissions.has('ManageChannels')) {
          embed
            .setAuthor({ name: `Permission Denied`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setDescription('Only the thread owner or server administrators can modify thread context.')
            .setColor(0xFF0000);
          return await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        const characteristicValue = interaction.options.getString('characteristics') ?? characteristics;
        const personalityValue = interaction.options.getString('personality') ?? personality;
        const preferenceValue = interaction.options.getString('preferences') ?? preferences;
        const dialogValue = interaction.options.getString('dialog') ?? dialog;
        const boundariesValue = interaction.options.getString('boundaries') ?? boundaries;
        const topicValue = interaction.options.getString('topic') ?? topic;
        const updatedContext = {
          roleplay_options: {
            characteristics: characteristicValue,
            personality: personalityValue,
            preferences: preferenceValue,
            dialog: dialogValue,
            boundaries: boundariesValue
          },
          topic: topicValue
        };
        await updateThreadContext(channel, updatedContext);
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
        // Same permission check as 'set'
        if (!interaction.channel.isThread() && !interaction.member.permissions.has('ManageChannels')) {
          embed
            .setAuthor({ name: `Permission Denied`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setDescription('Only server administrators can reset channel context.')
            .setColor(0xFF0000);
          return await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        if (interaction.channel.isThread() && interaction.channel.ownerId !== interaction.user.id && !interaction.member.permissions.has('ManageChannels')) {
          embed
            .setAuthor({ name: `Permission Denied`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setDescription('Only the thread owner or server administrators can reset thread context.')
            .setColor(0xFF0000);
          return await interaction.reply({ embeds: [embed], ephemeral: true });
        }
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
          summaries: [],
          messagesSinceLastSummary: 0,
          messagesSinceLastFacts: 0,
        };
        await updateThreadContext(channel, blankContext);
        embed
          .setAuthor({ name: `Chatbot Context Reset`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`Successfully reset chatbot context.`)
          .setColor(0xF9844A);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      case 'summary':
        const summaryScope = interaction.options.getString('scope') || 'channel';
        let summarySource;
        let summarySourceName;
        if (summaryScope === 'user') {
          const userData = await getUserChatbotData(interaction.user.id);
          summarySource = userData.summaries || [];
          summarySourceName = interaction.user.displayName;
        } else {
          summarySource = [...summaries];
          summarySourceName = channel.name;
        }
        const reversedSummaries = summarySource.reverse();
        const summaryTotalPages = Math.max(1, Math.ceil(reversedSummaries.length / SUMMARIES_PER_PAGE));
        const summaryPage = Math.min(interaction.options.getInteger('page') || 1, summaryTotalPages);
        const summarySlice = reversedSummaries.slice((summaryPage - 1) * SUMMARIES_PER_PAGE, summaryPage * SUMMARIES_PER_PAGE);
        if (summarySlice.length === 0) {
          embed
          .setAuthor({ name: `Error`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
          .setDescription(`No ${summaryScope} summaries found! Continue chatting with the bot and try again later`)
          .setColor(0xF9844A);
          return await interaction.reply({
            content: `No ${summaryScope} summaries found! Continue chatting with the bot and try again later`,
            ephemeral: true,
          });
        }
        const summaryFields = summarySlice.map((s, i) => {
          const globalIndex = reversedSummaries.length - ((summaryPage - 1) * SUMMARIES_PER_PAGE + i);
          const preview = s.context.length > 1024 ? s.context.slice(0, 1021) + '...' : s.context;
          const meta = [s.timestamp && `Generated: ${new Date(s.timestamp).toLocaleString()}`, s.mergedFrom && `Merged from: ${s.mergedFrom}`].filter(Boolean).join('\n');
          return { name: `Summary #${globalIndex}`, value: [preview, meta].filter(Boolean).join('\n'), inline: false };
        });
        const summaryPageLabel = summaryTotalPages > 1 ? ` (Page ${summaryPage}/${summaryTotalPages})` : '';
        embed
         .setAuthor({ name: `${summaryScope === 'user' ? 'User' : 'Channel'} Summaries for "${summarySourceName}"${summaryPageLabel}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
         .setFields(summaryFields)
         .setColor(0xF9844A);
         await interaction.reply({ embeds: [embed], ephemeral: true });
         break;
      case 'facts':
        const factsScope = interaction.options.getString('scope') || 'channel';
        let factsSource;
        let factsSourceName;
        if (factsScope === 'user') {
          const userData = await getUserChatbotData(interaction.user.id);
          factsSource = userData.facts || [];
          factsSourceName = interaction.user.displayName;
        } else {
          factsSource = facts || [];
          factsSourceName = channel.name;
        }
        let allFields = Object.entries(factsSource).map(([_, v]) => ({
          name: v.key.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())+`:`,
          value: v.value.toString().replace(/_/g, ' '),
          inline: true
        }));
        const totalPages = Math.max(1, Math.ceil(allFields.length / FIELDS_PER_PAGE));
        const page = Math.min(interaction.options.getInteger('page') || 1, totalPages);
        const pageFields = allFields.slice((page - 1) * FIELDS_PER_PAGE, page * FIELDS_PER_PAGE);
        const pageLabel = totalPages > 1 ? ` (Page ${page}/${totalPages})` : '';
        embed
         .setAuthor({ name: `${factsScope === 'user' ? 'User' : 'Channel'} Facts for "${factsSourceName}"${pageLabel}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
         .setFields(pageFields.length > 0 ? pageFields : [{ name: 'No facts found', value: 'Continue chatting with the bot and try again later', inline: false }])
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