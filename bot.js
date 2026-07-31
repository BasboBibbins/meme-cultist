// Load environment variables FIRST before any other imports
const dotenv = require("dotenv");
dotenv.config();

const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");
const { Player, GuildQueueEvent, useMainPlayer } = require("discord-player");
const { YoutubeiExtractor } = require("discord-player-youtubei");
const { GatewayIntentBits, Events, Client, Collection, InteractionType, Partials } = require("discord.js");
const { initDB, db, applyCommandStatsResets } = require("./database");
const { GUILD_ID, CLIENT_ID, CHATBOT_ENABLED, CHATBOT_LOCAL, BANNED_ROLE, APRIL_FOOLS_MODE, TESTING_ROLE, TESTING_MODE, OWNER_ID, FACTS_INTERVAL, SUMMARY_INTERVAL, OOC_PREFIX } = require("./config.js");
const { trackStart, trackEnd } = require("./utils/musicPlayer");
const { welcome, goodbye } = require("./utils/welcome");
const { interest } = require("./utils/bank");
const { handleBotMessage, deleteThreadContext, addNewThreadContext, getValidMessages, recordPerception } = require("./utils/openai");
const cacheDiag = require("./utils/cacheDiag");
const { summarizeFailure } = require("./utils/toolErrors");
const { describeImage } = require("./utils/llm");
const { extractFirstUrl, fetchPageText } = require("./utils/urlContext");
const { isChatbotChannel, formatChatbotChannelMentions } = require("./utils/channels");
const { initJackpot, addJackpotInterest } = require("./utils/jackpot");
const moment = require("dayjs");
const logger = require("./utils/logger");
const schedule = require("node-schedule");
const rateLimiter = require("./utils/ratelimiter");
const { DefaultExtractors } = require("@discord-player/extractor");
const playdl = require("play-dl");
const { sendDM } = require("./utils/dm");
const { buildInfoEmbed, COLORS } = require("./utils/embeds");
const { handleProposalInteraction } = require("./utils/kbProposals");

const TOKEN = process.env.TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (process.env.COOKIE) {
  playdl.setToken({
    youtube: {
      cookie: process.env.COOKIE
    }
  });
}

const LOAD_SLASH = process.argv[2] === "load";
const LOAD_DB = process.argv[2] === "dbinit";
const DEBUG_MODE = process.argv[2] === "debug";
const DELETE_SLASH = process.argv[2] === "delete";
const DELETE_SLASH_ID = process.argv[3];
const UNDO_APRILFOOLS = process.argv[2] === "afundo";

const banned = BANNED_ROLE;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ],
  // Reaction handling on uncached messages requires these partials —
  // most 📌 reactions arrive on older messages the bot has never seen.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

schedule.scheduleJob("0 */6 * * *", async () => { // every 6 h
  try {
    const { runCompactionJob } = require("./utils/compaction");
    await runCompactionJob();
  } catch (err) {
    logger.error(`[Compaction] Scheduled job failed: ${err.message}`);
  }
});

const dailyJob = schedule.scheduleJob("0 0 0 * * *", async () => { // 12:00 AM every day
  logger.debug(`Daily job started at ${moment().format("YYYY-MM-DD HH:mm:ss")}.`);
  await interest(client);
  await addJackpotInterest();
  try {
    const { ARCHIVE_RETENTION_DAYS, ARCHIVE_MAX_ROWS_PER_CHANNEL } = require("./config.js");
    const messageArchive = require("./utils/messageArchive");
    const summary = messageArchive.prune({
      retentionDays: ARCHIVE_RETENTION_DAYS,
      maxRowsPerChannel: ARCHIVE_MAX_ROWS_PER_CHANNEL,
    });
    if (summary.deletedByAge + summary.deletedByCap > 0) {
      logger.log(`[MessageArchive] Daily prune: ${summary.deletedByAge} aged out, ${summary.deletedByCap} over cap`);
    }
  } catch (err) {
    logger.warn(`[MessageArchive] Daily prune failed: ${err.message}`);
  }
});

client.slashcommands = new Collection();

client.contextResetPoints = new Map();
client.historyAnchors = new Map();
client.rouletteGames = new Map();
client.raceGames = new Map();
client.crapsGames = new Map();
client.blackjackTables = new Map();
client.slotsPanels = new Map();
client.duelGames = new Map();
client.pokerTables = new Map();
client.immediateFactsDebounce = new Map();
client.toolCallHistory = new Map();
client.perceptionCache = new Map();

if (!fs.existsSync("./db/users.sqlite")) {
  logger.error("Database file not found! Please run `node bot.js dbinit` to create the database.");
  process.exit(1);
}

const player = new Player(client, {
  ytdlOptions: {
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
    opusEncoded: true,
    requestOptions: {
      headers: {
        cookie: process.env.COOKIE
      }
    }
  }
});

process.on("unhandledRejection", (reason, p) => {
  logger.error(`Unhandled Promise Rejection! Reason: ${reason}`);
  console.log(p.stack || p);
})
  .on("uncaughtException", (err) => {
    logger.error(`Uncaught Exception: ${err}`);
    logger.error(err.stack);
    process.exit(1);
  });

function shutdownJobs() {
  try { require("./utils/jobs").stop(); } catch (_) {}
}
process.on("SIGINT", () => { shutdownJobs(); process.exit(0); });
process.on("SIGTERM", () => { shutdownJobs(); process.exit(0); });

const commands = [];

const walk = function(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = dir + "/" + file;
    const file_type = file.split(".").pop();
    const file_name = file.split(/(\\|\/)/g).pop();
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file_type === "js") results.push(file);
    }
  });
  return results;
};

const slashFiles = walk("./commands");

// Cache music command names at startup so we don't walk the filesystem on every command
const musicCommandNames = walk("./commands/music/").map(file => file.split("/").pop().replace(".js", ""));

for (const file of slashFiles) {
  const slashcmd = require(`${file}`);
  client.slashcommands.set(slashcmd.data.name, slashcmd);
  if (LOAD_SLASH) commands.push(slashcmd.data.toJSON());
}

if (DELETE_SLASH) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  if (DELETE_SLASH_ID) {
    logger.info(`Deleting slash command with ID \x1b[33m${DELETE_SLASH_ID}\x1b[0m...`);
    rest.delete(Routes.applicationCommand(CLIENT_ID, DELETE_SLASH_ID))
      .then(() => {
        logger.info(`Successfully deleted application (/) command with ID \x1b[33m${DELETE_SLASH_ID}\x1b[0m.`);
        process.exit(0);
      })
      .catch((err) => {
        if (err){
          logger.error(err);
          process.exit(1);
        }
      });
  } else {
    logger.info("Deleting all slash commands...");
    client.slashcommands.set([]);
    rest.put(Routes.applicationCommands(CLIENT_ID), {body: []})
      .then(() => {
        logger.info("Successfully deleted all application (/) commands.");
        process.exit(0);
      })
      .catch((err) => {
        if (err){
          logger.error(err);
          process.exit(1);
        }
      });
  }
} else if (LOAD_SLASH) {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  logger.info("Loading slash commands...");
  rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {body: commands})
    .then(() => {
      logger.info(`Successfully reloaded ${commands.length} application (/) commands.`);
      process.exit(0);
    })
    .catch((err) => {
      if (err){
        logger.error(err);
        process.exit(1);
      }
    });
} else {
  client.once(Events.ClientReady, async () => {
    if (LOAD_DB) {
      initDB(client);
      // backfill subjectUserId on existing user facts so stored memory
      // matches the new (key, subjectUserId) format.
      try {
        const { migrateUserFactSubjects } = require("./utils/openai");
        const res = await migrateUserFactSubjects();
        logger.info(`Fact subject migration: stamped ${res.factsStamped} fact(s) across ${res.users} user(s).`);
      } catch (err) {
        logger.error(`Fact subject migration failed: ${err.message}`);
      }
    }
    // Initialize progressive jackpot
    await initJackpot();
    if (APRIL_FOOLS_MODE) {
      logger.info("April Fools mode is enabled!");
      require("./utils/aprilfools").aprilfoolsMode(client, client.guilds.cache.get(GUILD_ID), OPENAI_API_KEY);
    }
    if (UNDO_APRILFOOLS && !APRIL_FOOLS_MODE) {
      require("./utils/aprilfools").undoAprilFools(client, client.guilds.cache.get(GUILD_ID));
    } else if (UNDO_APRILFOOLS && APRIL_FOOLS_MODE) {
      logger.error("April fools mode is still enabled! Disable in the config before running this command.");
      process.exit(1);
    }
    if (CHATBOT_LOCAL) {
      logger.debug(`Local model is ${CHATBOT_LOCAL ? "\x1b[32mON\x1b[0m" : "\x1b[31mOFF\x1b[0m"}`);
    }
    await player.extractors.loadMulti(DefaultExtractors);
    await player.extractors.register(YoutubeiExtractor, {});
    client.player = player;
    // Pre-warm slot image caches to eliminate cold-start latency on first spin
    try {
      const { warmCaches } = require("./utils/slotsCanvas");
      await warmCaches();
      logger.info("Slot image caches pre-warmed.");
    } catch (err) {
      logger.warn("Failed to pre-warm slot caches, will load on first spin.", { error: err });
    }
    // Pre-warm card spritesheet cache to eliminate cold-start latency on first poker hand
    try {
      const { warmCardCache } = require("./utils/cards");
      await warmCardCache("classic");
      logger.info("Card sheet pre-warmed.");
    } catch (err) {
      logger.warn("Failed to pre-warm card sheet, will load on first /poker.", { error: err });
    }
    logger.info(`Logged in as \x1b[33m${client.user.tag}\x1b[0m!`);
    if (DEBUG_MODE) {
      logger.info("DEBUG MODE ENABLED!");
    }

    // Sweep stale daily/monthly/yearly command stat buckets across all guild members.
    // Catches users who were inactive across a period rollover while the bot was down.
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (guild) {
        let resets = 0;
        for (const [memberId] of guild.members.cache) {
          if (memberId === client.user.id) continue;
          const before = await db.get(`${memberId}.stats.commands.dailyReset`);
          await applyCommandStatsResets(memberId);
          const after = await db.get(`${memberId}.stats.commands.dailyReset`);
          if (before !== after) resets++;
        }
        logger.info(`Stats reset sweep complete (${resets} user${resets === 1 ? "" : "s"} rolled over).`);
      }
    } catch (err) {
      logger.warn("Stats reset sweep failed.", { error: err });
    }

    // Start the durable job queue. Ships with no handlers registered;
    // future features (reminders, async embeddings, proactive triggers)
    // will queue.register(...) elsewhere before any enqueue.
    const jobs = require("./utils/jobs");
    const { REMINDER_DM_FALLBACK, REMINDER_MAX_GROUP_SIZE } = require("./config.js");
    const kbStore = require("./utils/kb");
    const llm = require("./utils/llm");
    jobs.register("kb_embed", async (payload) => {
      const { guildId, slug } = payload;
      const entry = kbStore.getBySlug(guildId, slug);
      if (!entry) {
        logger.warn(`[KB Embed] Entry ${slug} not found in guild ${guildId}`);
        return;
      }
      try {
        const text = `${entry.title}\n${entry.content}`;
        const { embedding } = await llm.embed({ text });
        kbStore.setEmbedding(guildId, slug, embedding);
        logger.log(`[KB Embed] Embedded "${slug}" (${embedding.length} dims)`);
      } catch (err) {
        logger.error(`[KB Embed] Failed for "${slug}": ${err.message}`);
      }
    });

    const messageArchive = require("./utils/messageArchive");
    jobs.register("message_embed", async (payload) => {
      const { channelId, chunkIds } = payload;
      try {
        const all = messageArchive.getUnembeddedForChannel(channelId, 100);
        const unembedded = chunkIds && chunkIds.length > 0
          ? all.filter(r => chunkIds.includes(r.id))
          : all;
        if (unembedded.length === 0) return;

        const llm = require("./utils/llm");
        for (const chunk of unembedded) {
          try {
            const { embedding } = await llm.embed({ text: chunk.content });
            messageArchive.setEmbedding(chunk.id, embedding);
          } catch (err) {
            logger.error(`[MessageEmbed] Failed for chunk ${chunk.id}: ${err.message}`);
          }
        }
        logger.log(`[MessageEmbed] Embedded ${unembedded.length} chunks for ${channelId}`);
      } catch (err) {
        logger.error(`[MessageEmbed] Batch failed for ${channelId}: ${err.message}`);
      }
    });

    const episodeStore = require("./utils/episodes");
    jobs.register("episode_embed", async (payload) => {
      const { episodeIds } = payload;
      if (!episodeIds || episodeIds.length === 0) return;
      const llm = require("./utils/llm");
      const unembedded = episodeStore.getByIds(episodeIds);
      if (unembedded.length === 0) return;
      let embedded = 0;
      for (const ep of unembedded) {
        try {
          const { embedding } = await llm.embed({ text: ep.summary });
          episodeStore.setEmbedding(ep.id, embedding);
          embedded += 1;
        } catch (err) {
          logger.error(`[EpisodeEmbed] Failed for episode ${ep.id}: ${err.message}`);
        }
      }
      if (embedded > 0) logger.log(`[EpisodeEmbed] Embedded ${embedded} episodes`);
    });

    jobs.register("backfill_messages", async (payload) => {
      const { channelIds } = payload;
      if (!channelIds || channelIds.length === 0) return;
      const llm = require("./utils/llm");
      for (const channelId of channelIds) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (!channel) continue;
          let lastId = messageArchive.getMaxMessageIdForChannel(channelId);
          let totalInserted = 0;
          let hasMore = true;
          while (hasMore) {
            const options = lastId ? { limit: 100, before: lastId } : { limit: 100 };
            const fetched = await channel.messages.fetch(options);
            if (fetched.size === 0) {
              hasMore = false;
              break;
            }
            const msgs = Array.from(fetched.values()).reverse();
            for (const msg of msgs) {
              if (!msg.content) continue;
              const id = messageArchive.insertChunk({
                channelId,
                messageId: msg.id,
                authorId: msg.author.id,
                content: msg.content,
                chunkIndex: 0,
                createdAt: msg.createdTimestamp,
              });
              if (id) totalInserted++;
              lastId = msg.id;
            }
            if (fetched.size < 100) hasMore = false;
          }
          if (totalInserted > 0) {
            jobs.enqueue({
              kind: "message_embed",
              payload: { channelId, chunkIds: [] },
              run_at: Date.now(),
            });
            logger.log(`[Backfill] Inserted ${totalInserted} messages for ${channelId}, enqueued embed job.`);
          } else {
            logger.log(`[Backfill] No new messages for ${channelId}.`);
          }
        } catch (err) {
          logger.error(`[Backfill] Failed for ${channelId}: ${err.message}`);
        }
      }
    });

    jobs.register("reminder", async (payload) => {
      const { userId, channelId, text, targets, recurrence } = payload;
      const notifyIds = targets && targets.length > 0 ? targets : [userId];
      const guild = client.guilds.cache.get(GUILD_ID);

      const resolvedUserIds = new Set();
      for (const id of notifyIds) {
        if (id.startsWith("role:")) {
          const roleId = id.slice(5);
          if (!guild) continue;
          try {
            const role = await guild.roles.fetch(roleId);
            if (role) {
              for (const [memberId] of role.members) {
                resolvedUserIds.add(memberId);
              }
            }
          } catch (_) {}
        } else {
          resolvedUserIds.add(id);
        }
      }

      if (resolvedUserIds.size > REMINDER_MAX_GROUP_SIZE) {
        logger.warn(`[Reminder] Group size ${resolvedUserIds.size} exceeds limit ${REMINDER_MAX_GROUP_SIZE}, truncating.`);
        const trimmed = Array.from(resolvedUserIds).slice(0, REMINDER_MAX_GROUP_SIZE);
        resolvedUserIds.clear();
        for (const uid of trimmed) resolvedUserIds.add(uid);
      }

      const reminderEmbed = buildInfoEmbed(client.user, client, text, COLORS.gold)
        .setTitle("⏰ Reminder");

      for (const uid of resolvedUserIds) {
        let sent = false;
        if (REMINDER_DM_FALLBACK) {
          try {
            const user = await client.users.fetch(uid);
            const dm = await sendDM(user, { embeds: [reminderEmbed] });
            if (dm) sent = true;
          } catch (_) {}
        }
        if (!sent && channelId) {
          try {
            const channel = await client.channels.fetch(channelId);
            await channel.send({ embeds: [reminderEmbed] });
            sent = true;
          } catch (_) {}
        }
        if (!sent) {
          logger.warn(`[Reminder] No reachable target for user ${uid}, dropping reminder.`);
        }
      }

      if (recurrence) {
        const nextCount = (recurrence.firedCount || 0) + 1;
        const nextRunAt = Date.now() + recurrence.intervalMs;
        const hitEnd = (recurrence.endAt && nextRunAt > recurrence.endAt) ||
                    (recurrence.maxOccurrences && nextCount >= recurrence.maxOccurrences);
        if (!hitEnd) {
          jobs.enqueue({
            kind: "reminder",
            payload: {
              ...payload,
              recurrence: { ...recurrence, firedCount: nextCount }
            },
            run_at: nextRunAt,
          });
          logger.log(`[Reminder] Scheduled next occurrence (count=${nextCount})`);
        } else {
          logger.log(`[Reminder] Recurrence ended after ${nextCount} occurrence(s).`);
        }
      }
    });
    jobs.start();

    const { CHATBOT_CHANNELS } = require("./config.js");
    for (const channelId of CHATBOT_CHANNELS) {
      try {
        if (messageArchive.countForChannel(channelId) === 0) {
          jobs.enqueue({
            kind: "backfill_messages",
            payload: { channelIds: [channelId] },
            run_at: Date.now(),
          });
          logger.log(`[Backfill] Triggered for channel ${channelId}`);
        }
      } catch (err) {
        logger.error(`[Backfill] Trigger failed for ${channelId}: ${err.message}`);
      }
    }
  });

  if (DEBUG_MODE) client.on(Events.Debug, (info) => logger.debug(info));
  client.on(Events.Warn, (info) => logger.warn(info));
  client.on(Events.Error, (info) => logger.error(info));

  client.on(Events.GuildMemberAdd, async member => {
    if (member.guild.id === GUILD_ID) {
      await welcome(client, member);
    }
  });

  client.on(Events.GuildMemberRemove, async member => {
    if (member.guild.id === GUILD_ID) {
      await goodbye(client, member);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    // KB proposal buttons live in the owner's DMs (no guild/member), so route
    // them before any guild-scoped checks below. The edit modal is awaited
    // inline by the button handler, so its submit is acknowledged here too.
    if (interaction.isButton() && interaction.customId.startsWith("kbprop:")) {
      return handleProposalInteraction(interaction, client);
    }
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("kbpropedit:")) {
      // A collector in the edit handler awaits this modal inline. If it's still
      // waiting, let that resolve it; otherwise the collector already timed out,
      // so ack here rather than leaving the owner with "This interaction failed".
      if (client.pendingKbEdits && client.pendingKbEdits.has(interaction.customId)) return;
      return interaction.reply({
        content: "That edit window has expired. Re-open the suggestion and use Edit again.",
        ephemeral: true,
      }).catch(() => {});
    }
    // interaction.member is null for DM interactions (e.g. owner-DM components),
    // so guard before the guild-only roles check.
    if (!interaction.isCommand() && interaction.member && interaction.member.roles.cache.has(banned)) {
      return await sendDM(interaction.user, {
        content: `You are banned from using ${interaction.client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${interaction.guild.name}.`,
      });
    }
    if (interaction.isChatInputCommand()) {
      interaction.channel.sendTyping().then(async () => {
                
        const command = interaction.client.slashcommands.get(interaction.commandName);
        if (!command) {
          logger.error(`No command matching ${interaction.commandName} was found.`);
          return;
        }

        if (TESTING_MODE && !interaction.member.roles.cache.has(TESTING_ROLE)){
          await interaction.reply({content: `The new ${interaction.client.user.username} is currently in beta! Contact <@${OWNER_ID}> for access!`, ephemeral: true});
          return;
        }

        if (interaction.member.roles.cache.has(banned)){
          await interaction.reply({content: `You are banned from using ${interaction.client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${interaction.guild.name}.`, ephemeral: true});
          return;
        }
            
        try {
          const isMusicCommand = (commandName) => musicCommandNames.includes(commandName);
          if (isMusicCommand(command.data.name)) { // provide player context if music command
            const data = {
              guild: interaction.guild
            };
            await player.context.provide(data, () => command.execute(interaction));
          } else {
            await command.execute(interaction);
          }

          logger.info(`${interaction.user.tag} used command \x1b[33m\`${interaction.commandName}\`\x1b[0m in #${interaction.channel.name} in ${interaction.guild.name}.`);
          if (db) {
            const userId = interaction.user.id;
            const cmdName = interaction.commandName;

            // Apply any pending period resets, then increment counters in memory
            // and persist with a single scoped write.
            const commands = await applyCommandStatsResets(userId);
            commands.daily[cmdName] = (commands.daily[cmdName] || 0) + 1;
            commands.monthly[cmdName] = (commands.monthly[cmdName] || 0) + 1;
            commands.yearly[cmdName] = (commands.yearly[cmdName] || 0) + 1;
            commands.total[cmdName] = (commands.total[cmdName] || 0) + 1;
            await db.set(`${userId}.stats.commands`, commands);

            // Largest balance/bank checks — narrow writes only, separate from
            // the commands subtree to avoid racing with the midnight interest job.
            const [balance, largestBalance, bank, largestBank] = await Promise.all([
              db.get(`${userId}.balance`),
              db.get(`${userId}.stats.largestBalance`),
              db.get(`${userId}.bank`),
              db.get(`${userId}.stats.largestBank`),
            ]);
            const statWrites = [];
            if (balance > (largestBalance || 0)) statWrites.push(db.set(`${userId}.stats.largestBalance`, balance));
            if (bank > (largestBank || 0)) statWrites.push(db.set(`${userId}.stats.largestBank`, bank));
            if (statWrites.length) await Promise.all(statWrites);
          }
        } catch (error) {
          logger.error(error);
          await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
        }
      });
    } else if (interaction.isAutocomplete()) {
      const command = interaction.client.slashcommands.get(interaction.commandName);

      if (!command) {
        logger.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.autocomplete(interaction);
      } catch (error) {
        logger.error(error);
      }
    } else if (interaction.type === InteractionType.ModalSubmit) {
      // Modals are owned by their originating command via awaitModalSubmit
      // (e.g. utils/betModal.js uses customId "betmodal_*"). Acknowledging
      // here would race the collector and produce 10062 Unknown Interaction.
      logger.info(`${interaction.user.tag} submitted modal ${interaction.customId} in #${interaction.channel.name} in ${interaction.guild.name}.`);
    }
  });
  // Musicbot events
  player.events.on(GuildQueueEvent.AudioTrackAdd, async (queue, track) => {
    logger.log(`${track.title} added to queue in ${queue.guild.name}!`);
  });
  player.events.on(GuildQueueEvent.AudioTracksAdd, async (queue, tracks) => {
    logger.log(`${tracks.length} tracks added to queue in ${queue.guild.name}!`);
  });
  player.events.on(GuildQueueEvent.PlayerStart, async (queue, track) => {
    logger.log(`Now playing ${track.title} in ${queue.guild.name}!`);
    await trackStart(client, queue, track);
  });
  player.events.on(GuildQueueEvent.PlayerFinish, async (queue, track) => {
    logger.log(`Finished playing ${track.title} in ${queue.guild.name}!`);
    await trackEnd(client, queue, track);
  });
  player.events.on(GuildQueueEvent.Disconnect, async (queue) => {
    logger.warn(`Nobody is in the voice channel, leaving ${queue.guild.name}!`);
    await queue.player.destroy();
  });
  player.events.on(GuildQueueEvent.Error, async (queue, error) => {
    logger.error(`Error in ${queue.guild.name}'s queue! - ${error.message}`);
    logger.error(error.stack);
  });

  // Chatbot events
  client.on(Events.ThreadCreate, async (thread) => {
    logger.info(`Thread "${thread.name}" [${thread.id}] created in ${thread.guild.name}.`);
    if (isChatbotChannel(thread.parentId)) {
      await addNewThreadContext(thread);
    } 
  });

  client.on(Events.ThreadDelete, async (thread) => {
    logger.info(`Thread "${thread.name}" [${thread.id}] deleted in ${thread.guild.name}.`);
    client.contextResetPoints.delete(thread.id);
    client.historyAnchors.delete(thread.id);
    cacheDiag.forgetChannel(thread.id);
    if (isChatbotChannel(thread.parentId)) {
      await deleteThreadContext(thread);
    }
  });

  client.on(Events.MessageDelete, async (message) => {
    if (client.toolCallHistory.has(message.id)) {
      client.toolCallHistory.delete(message.id);
      logger.debug(`[ToolCallHistory] Cleaned up deleted message ${message.id}`);
    }
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      await require("./utils/bookmarks").handleBookmarkReaction(reaction, user);
    } catch (err) {
      logger.error(`[Bookmark] Reaction handler failed: ${err.message}`);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!CHATBOT_ENABLED) {
      logger.warn("Chatbot is disabled! Ignoring request...");
      return;
    }
    if (message.content.startsWith(OOC_PREFIX)) {
      return;
    }
    if (message.member.roles.cache.has(banned)) {
      logger.warn(`User ${message.author.username} is banned from using the bot. Ignoring request...`);
      const dmChannel = await message.author.createDM().catch(() => null);
      if (dmChannel) {
        const isLastMsgBot = dmChannel.lastMessage && dmChannel.lastMessage.author.id === client.user.id;
        if (isLastMsgBot) {
          await sendDM(message.author, {
            content: `You are banned from using ${client.user.username}. If you believe this is a mistake, contact <@${OWNER_ID}> or an admin in ${message.guild.name}.`,
          });
        }
      }
      return;
    }

    const isMentioned = message.mentions.has(client.user, { ignoreEveryone: true, ignoreRoles: true });
    const isChatbotChannelResult = isChatbotChannel(message.channel.id, message.channel.parentId);

    if (!isChatbotChannelResult && !isMentioned) return;

    if (!isChatbotChannelResult) {
      const rateCheck = rateLimiter.canMentionBot(message.author.id);
      if (!rateCheck.allowed) {
        const channelText = formatChatbotChannelMentions(client);
        return message.reply({ content: `⏳ ${rateCheck.reason} You can chat with me unlimited times in ${channelText}.`, ephemeral: true });
      }
    }

    if (isChatbotChannelResult) {
      const turnCheck = rateLimiter.beginChatTurn(message.author.id);
      if (!turnCheck.allowed) {
        return message.reply({ content: `⏳ ${turnCheck.reason}` }).catch(() => {});
      }
    }

    // Perception must never abort the turn: a failure here still has to reach
    // handleBotMessage as [VISION/LINK UNAVAILABLE] so the bot explains itself
    // instead of going silent. The finally also has to cover this block, or a
    // throw would leak the user's chat-turn slot and lock them out.
    try {
      let extraContext = null;
      const imageAttachment = message.attachments.find(a => a.contentType?.startsWith("image/"));
      if (imageAttachment) {
        message.channel.sendTyping().catch(() => {});
        const displayName = message.member?.displayName || message.author.username;
        let result;
        try {
          result = await describeImage({ imageUrl: imageAttachment.url, userHint: message.content || null });
        } catch (err) {
          const { code, reason } = summarizeFailure(err);
          logger.error(`[Perception] describeImage threw (${code}): ${err.message}`);
          result = { error: `vision is unavailable right now — ${reason}` };
        }
        if (result?.description) {
          extraContext = `[Image you are currently looking at, shared by ${displayName}]\n${result.description}`;
          recordPerception(client, message.channel.id, {
            messageId: message.id,
            authorId: message.author.id,
            authorName: displayName,
            kind: "image",
            text: result.description,
            at: message.createdTimestamp,
          });
        } else if (result?.error) {
          extraContext = `[VISION UNAVAILABLE — ${displayName} shared an image but you cannot see it]\nReason: ${result.error}\nTell the user you couldn't see the image and briefly say why, in your own words. Do NOT pretend to see it, and do NOT quote error text, status codes, or service names.`;
        }
      } else {
        const url = extractFirstUrl(message.content);
        if (url) {
          message.channel.sendTyping().catch(() => {});
          let page;
          try {
            page = await fetchPageText(url);
          } catch (err) {
            const { code, reason } = summarizeFailure(err);
            logger.error(`[Perception] fetchPageText threw (${code}): ${err.message}`);
            page = { url, error: `the page could not be loaded — ${reason}` };
          }
          if (page?.text) {
            extraContext = `[Webpage you are currently reading: ${page.url}]\n${page.title ? `Title: ${page.title}\n` : ""}${page.text}`;
            recordPerception(client, message.channel.id, {
              messageId: message.id,
              authorId: message.author.id,
              authorName: message.member?.displayName || message.author.username,
              kind: "link",
              text: `${page.title ? `${page.title} — ` : ""}${page.text}`,
              at: message.createdTimestamp,
            });
          } else if (page?.error) {
            extraContext = `[LINK UNAVAILABLE — ${page.url} could not be loaded]\nReason: ${page.error}\nTell the user you couldn't open the link and briefly say why, in your own words. Do NOT pretend to have read it, and do NOT quote error text, status codes, or service names.`;
          }
        }
      }

      if (isChatbotChannelResult && !APRIL_FOOLS_MODE) {
        await handleBotMessage(client, message, null, null, false, extraContext);
      } else if (isMentioned) {
        await handleBotMessage(client, message, null, null, true, extraContext);
      }
    } finally {
      if (isChatbotChannelResult) {
        rateLimiter.endChatTurn(message.author.id);
      }
    }
  });

  client.login(TOKEN);
}
