const { AttachmentBuilder } = require("discord.js");
const { db: usersDb } = require("../database");
const logger = require("./logger");
const { getCurrentTopUsers, getAllTimeTopUsers } = require("./bank");
const { generateImage, embed } = require("./llm");
const { canGenerateImage } = require("./ratelimiter");
const { isChatbotChannel, formatChatbotChannelMentions } = require("./channels");
const kbStore = require("./kb");
const messageArchive = require("./messageArchive");
const { getJackpot, MIN_BET: JACKPOT_MIN_BET, RATE: JACKPOT_RATE } = require("./jackpot");
const { getDailyShopStock, nextShopResetEpoch, formatPrice } = require("./inventory");
const explanations = require("./explanations");
const { CURRENCY_NAME, REMINDER_MAX_ACTIVE_PER_USER, REMINDER_MAX_GROUP_SIZE, BRAVE_API_KEY, EPISODE_RECALL_MIN_SCORE } = require("../config.js");
const { fetchPageText } = require("./urlContext");
const jobs = require("./jobs");
const { parseWhen } = require("./reminders/parse");
const { validateToolArgs } = require("./schemas");
const gameResults = require("./gameResults");
const episodes = require("./episodes");
const kbProposals = require("./kbProposals");

// Tool definitions for DeepSeek function calling
const SIDE_EFFECT_TOOLS = new Set(["generate_image", "set_reminder", "propose_kb_entry"]);

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_balance",
      description: "Get a user's wallet and bank balance in koku.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "Discord user ID or username (optional, defaults to current user)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_leaderboard",
      description: "Get the top 10 users ranked by bank balance.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["current", "all_time"], description: "Current or all-time leaderboard (default: current)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_user_stats",
      description: "Get a user's game statistics (blackjack, slots, poker, etc.), command usage counts, and records.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "Discord user ID or username (optional, defaults to current user)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_guild_info",
      description: "Get information about the current Discord server: name, member count, channels, and roles.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_user_info",
      description: "Get a Discord user's profile: display name, avatar URL, roles, and join date.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "Discord user ID or username (optional, defaults to current user)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_bot_info",
      description: "Get a list of this bot's available slash commands and what they do.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate a brand-new image from a text prompt and attach it to your reply. " +
        "CALL THIS TOOL whenever the user explicitly asks you to make, create, generate, draw, paint, render, or design an image/picture/drawing/meme/artwork/poster. " +
        "This includes requests like: 'draw me a cat', 'make an image of a sunset', 'generate a meme about X', 'can you create a picture of Y?', 'render a dragon'. " +
        "IMPORTANT: You CANNOT create images yourself — you MUST use this tool to produce them. Never claim you generated or attached an image without calling this tool first. " +
        "You MUST call this tool. Never type '[Attached: image file]' or any similar text instead of using the tool. " +
        "Do NOT call for: metaphorical 'imagine/picture this', discussing existing images, describing visuals, or reacting to images the user already shared.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "The user's image request, rewritten as a detailed visual description. " +
              "Include subject, style, setting, composition, and mood."
          }
        },
        required: ["prompt"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Set a reminder for the user. The bot will send a message at the requested time.",
      parameters: {
        type: "object",
        properties: {
          when: { type: "string", description: "When to remind, e.g. 'in 2 hours', 'tomorrow at 3pm'" },
          message: { type: "string", description: "What to remind the user about" },
          channel_id: { type: "string", description: "Discord channel ID to post in (default: DM the user)" },
          targets: {
            type: "array",
            items: { type: "string" },
            description: "Optional Discord user IDs or role IDs to notify. Role IDs must be prefixed with 'role:'. Defaults to the requesting user."
          },
          frequency: {
            type: "string",
            enum: ["once", "daily", "weekly"],
            description: "How often to repeat. Default: once"
          },
          end_date: {
            type: "string",
            description: "When to stop repeating, e.g. 'in 2 weeks', 'next month'"
          },
          occurrences: {
            type: "integer",
            description: "Max number of repetitions"
          }
        },
        required: ["when", "message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_kb",
      description:
        "Search the server's knowledge base for articles related to a topic. Returns up to 3 relevant entries. " +
        "USE THIS TOOL whenever the user asks about server rules, FAQs, wiki topics, or curated knowledge. " +
        "Do not guess — search the knowledge base first.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The topic or question to look up in the knowledge base." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_jackpot",
      description:
        "Get the current progressive jackpot amount, the last winner (if any), and the minimum bet required to be eligible. " +
        "Call this whenever the user asks about the jackpot, the prize pool, who last hit the jackpot, or how big the pot is.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_command_help",
      description:
        "Look up help on a slash command or a feature explanation (the same content surfaced by /help and the /help explanations dropdown). " +
        "Resolves command names first (e.g. 'slots', 'balance'), then falls back to feature explanations (e.g. 'currency', 'dailyweekly'). " +
        "Supports prefix/substring matching, so 'slot' will resolve to 'slots'. " +
        "Call this whenever the user asks how a command works, what a command does, what its options are, or how a feature/game works.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The slash command name or feature key (e.g. 'slots', 'balance', 'currency')." }
        },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_shop",
      description:
        "Get today's daily shop stock for this guild. Returns the rotating items currently for sale (name, price, rarity, tier, description) " +
        "and the relative time until the shop next resets. Call this when the user asks what's in the shop, what's for sale today, " +
        "what they can buy, or when the shop resets.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "search_history",
      description:
        "Semantic + FTS search of this channel's past message history. " +
        "Call AT MOST ONCE per turn with a single, comprehensive query covering everything you want to find. " +
        "If results are empty or thin, synthesize from what is returned — do NOT retry with re-phrasings. " +
        "Returns up to 5 hits with author, content, and timestamp.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A single comprehensive query covering everything you want to find." },
          limit: { type: "integer", description: "Number of results to return (default 5, max 10)." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_game_result",
      description:
        "Get the most recent game result for a user in this channel. Returns structured data about their last play — grid, cards, dice, payout, bet — that is not visible in the embed or canvas image. " +
        "Call this when a user says things like 'did you see my win?', 'look what I just hit', 'check out my hand', 'how'd I do?', or makes any reference to a game they just played.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "Discord user ID or username to look up (optional — defaults to the user who sent this message)" },
          game: {
            type: "string",
            enum: ["slots", "blackjack", "roulette", "craps", "race", "poker"],
            description: "Filter to a specific game (optional — omit to return the most recent result regardless of game type)"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_recent_game_results",
      description:
        "Get recent game results for a user (or the whole channel). " +
        "Use for 'what have I been hitting lately', 'how have I been doing in slots', 'show me my last few hands', or similar multi-result queries.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "Discord user ID or username to filter to (optional — omit for channel-wide results)" },
          game: {
            type: "string",
            enum: ["slots", "blackjack", "roulette", "craps", "race", "poker"],
            description: "Filter to a specific game (optional)"
          },
          limit: { type: "integer", description: "Number of results to return (default 5, max 10)" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "recall_episode",
      description:
        "Retrieve specific past events from episodic memory — things that happened on a particular occasion, " +
        "like 'basbo hit a jackpot last Tuesday' or 'we decided to start a race tournament in May'. " +
        "Use this when the user references a specific past event, asks what happened on a specific occasion, " +
        "or when semantic facts are not enough. " +
        "Scope 'channel' searches shared channel events; 'user' searches the speaker's personal episodes; " +
        "'both' searches both.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language description of the event to recall." },
          scope: {
            type: "string",
            enum: ["channel", "user", "both"],
            description: "Which episode store to search (default: both)."
          },
          limit: { type: "integer", description: "Max episodes to return (1–10, default 5)." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "propose_kb_entry",
      description:
        "Propose a new knowledge-base article for the bot owner to review. " +
        "Call this ONLY when the conversation has produced durable, server-scoped knowledge worth saving to the wiki — " +
        "a lore decision, a custom rule clarification, an established server event, or a fact everyone in the server should be able to look up later. " +
        "Do NOT call for personal facts about a user, transient chatter, opinions, or anything already answerable via lookup_kb. " +
        "The entry is NOT added immediately — it is queued for the owner to approve, edit, or reject.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short, descriptive title for the article (max 100 chars)." },
          body: { type: "string", description: "The article content: the durable knowledge to record (max 4000 chars)." },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional short keywords to help retrieve this entry later."
          }
        },
        required: ["title", "body"]
      }
    }
  },
  ...(BRAVE_API_KEY ? [
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web for current information, recent events, or facts you don't know. " +
          "Returns top results with title, URL, and snippet. " +
          "Use fetch_page after this to read the full content of a specific result URL.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." },
            count: { type: "integer", description: "Number of results to return (1–10, default 5)." }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "fetch_page",
        description:
          "Fetch and extract the readable text content of a web page URL. " +
          "Use this after web_search to get the full content of a specific result.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch." }
          },
          required: ["url"]
        }
      }
    },
  ] : []),
];

// Helper to resolve a user ID or username to a guild member
async function resolveMember(input, guild) {
  if (!input) return null;

  // If it looks like a Discord snowflake ID (17-19 digits)
  if (/^\d{17,19}$/.test(input)) {
    return guild.members.fetch(input).catch(() => null);
  }

  // Otherwise, search by display name, username, or nickname
  const searchName = input.toLowerCase().replace(/^@/, "");
  const members = await guild.members.fetch();

  return members.find(m =>
    m.displayName.toLowerCase() === searchName ||
    m.user.username.toLowerCase() === searchName ||
    (m.nickname && m.nickname.toLowerCase() === searchName)
  ) || null;
}

async function handleGetBalance(args, message) {
  const guild = message.guild;

  let user;
  if (args.user_id) {
    user = await resolveMember(args.user_id, guild);
    if (!user) return { error: `User "${args.user_id}" not found in this server.` };
  } else {
    user = message.member;
  }

  const userData = await usersDb.get(user.id);
  if (!userData) return { error: "User has no data yet." };

  return {
    user_id: user.id,
    username: user.displayName,
    balance: userData.balance ?? 0,
    bank: userData.bank ?? 0,
    currency: CURRENCY_NAME
  };
}

async function handleGetLeaderboard(args, message) {
  const type = args.type || "current";

  const topUsers = type === "all_time"
    ? await getAllTimeTopUsers()
    : await getCurrentTopUsers();

  return {
    type: type,
    users: topUsers.slice(0, 10).map((u, i) => ({
      rank: i + 1,
      user_id: u.id,
      username: u.value.name || "Unknown",
      bank: type === "all_time" ? (u.value.stats?.largestBank ?? u.value.bank ?? 0) : (u.value.bank ?? 0)
    }))
  };
}

async function handleGetUserStats(args, message) {
  const guild = message.guild;

  let member;
  if (args.user_id) {
    member = await resolveMember(args.user_id, guild);
    if (!member) return { error: `User "${args.user_id}" not found in this server.` };
  } else {
    member = message.member;
  }

  const userData = await usersDb.get(member.id);
  if (!userData) return { error: "User has no data yet." };

  const stats = userData.stats || {};

  const totalCommands = Object.values(stats.commands?.total || {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);

  const gameStats = {};
  const gameKeys = ["blackjack", "slots", "flip", "roulette", "race", "begs"];
  for (const key of gameKeys) {
    if (stats[key]) {
      gameStats[key] = { ...stats[key] };
    }
  }

  return {
    user_id: member.id,
    username: member.displayName,
    balance: userData.balance ?? 0,
    bank: userData.bank ?? 0,
    total_commands: totalCommands,
    cooldowns: {
      daily: userData.cooldowns?.daily || 0,
      weekly: userData.cooldowns?.weekly || 0,
      rob: userData.cooldowns?.rob || 0,
      freespins: userData.cooldowns?.freespins || 0,
    },
    commands: {
      daily: stats.commands?.daily || {},
      monthly: stats.commands?.monthly || {},
      yearly: stats.commands?.yearly || {}
    },
    dailies: stats.dailies || { claimed: 0, currentStreak: 0, longestStreak: 0 },
    weeklies: stats.weeklies || { claimed: 0 },
    games: gameStats,
    records: {
      largestBalance: stats.largestBalance ?? 0,
      largestBank: stats.largestBank ?? 0
    }
  };
}

async function handleGetGuildInfo(args, message, client) {
  const guild = message.guild;
  logger.debug(`Fetching guild info for "${guild.name}" (ID: ${guild.id})`);
  console.log(`\x1b[33m${message.guild}\x1b[0m`);

  return {
    name: guild.name,
    id: guild.id,
    member_count: guild.memberCount,
    members: guild.members.cache.map(m => ({
      user_id: m.id,
      username: m.user.username,
      display_name: m.displayName || m.user.username,
      nickname: m.nickname || m.user.username}
    )).slice(0, 100), // Limit to first 100 members for brevity
    channel_count: guild.channels.cache.size,
    role_count: guild.roles.cache.size,
    bot_name: client.user.username,
    created_at: guild.createdAt.toISOString()
  };
}

async function handleGetUserInfo(args, message) {
  const guild = message.guild;

  let member;
  if (args.user_id) {
    member = await resolveMember(args.user_id, guild);
    if (!member) return { error: `User "${args.user_id}" not found in this server.` };
  } else {
    member = message.member;
  }

  const userData = await usersDb.get(member.id);

  return {
    user_id: member.id,
    username: member.user.username,
    display_name: member.displayName,
    nickname: member.nickname,
    avatar_url: member.displayAvatarURL({ dynamic: true }),
    roles: member.roles.cache
      .filter(r => r.name !== "@everyone")
      .map(r => r.name)
      .slice(0, 10),
    joined_at: member.joinedAt?.toISOString(),
    account_created: member.user.createdAt.toISOString(),
    balance: userData?.balance ?? 0,
    bank: userData?.bank ?? 0,
    user_facts: userData?.chatbot?.facts || [],
    user_summary: userData?.chatbot?.summaries ? userData.chatbot.summaries.slice(-1)[0] : null,
    chatbot_msg_count: userData?.chatbot?.messageCount || 0,
  };
}

async function handleGetBotInfo(args, message, client) {
  const commands = [];

  client.slashcommands.forEach((cmd, name) => {
    commands.push({
      name: cmd.data.name,
      description: cmd.data.description,
      options: cmd.data.options?.map(opt => ({
        name: opt.name,
        description: opt.description,
        required: opt.required
      })) || []
    });
  });

  return {
    bot_name: client.user.username,
    bot_id: client.user.id,
    total_commands: commands.length,
    commands: commands.sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function handleGenerateImage(args, message, client, toolCtx) {
  if (!isChatbotChannel(message.channelId, message.channel?.parentId)) {
    const mentions = formatChatbotChannelMentions(client);
    return { error: `Image generation is only available in chatbot channels: ${mentions}.` };
  }
  if (!args?.prompt) return { error: "Missing required 'prompt' argument." };
  const rateCheck = canGenerateImage(message.author.id);
  if (!rateCheck.allowed) {
    return { error: rateCheck.reason };
  }
  try {
    const { buffer, mimeType } = await generateImage({ prompt: args.prompt });
    if (toolCtx) {
      const ext = mimeType?.includes("png") ? "png" : "jpg";
      toolCtx.pendingAttachments.push(
        new AttachmentBuilder(buffer).setName(`generated.${ext}`)
      );
    }
    return {
      success: true,
      message: "Image generated. It will be attached to your message automatically. Simply reply naturally. Do not describe the image or include any attachment markup."
    };
  } catch (err) {
    logger.error(`[generate_image] ${err.message}`);
    return { error: `Image generation failed: ${err.message}` };
  }
}

async function handleSetReminder(args, message, client, toolCtx) {
  if (!args?.when || !args?.message) {
    return { error: "Missing required 'when' or 'message' argument." };
  }

  const parsed = parseWhen(args.when);
  if (!parsed.ok) {
    return { error: parsed.reason };
  }

  const userId = message.author.id;
  const activeCount = jobs.list("reminder", row => {
    try {
      return JSON.parse(row.payload).userId === userId;
    } catch (_) {
      return false;
    }
  }).length;

  if (activeCount >= REMINDER_MAX_ACTIVE_PER_USER) {
    return { error: `You already have ${activeCount} active reminders. Cancel one first.` };
  }

  // Always target the message author; ignore any hallucinated IDs from the model.
  const targets = [userId];

  let recurrence = null;
  const frequency = args.frequency || "once";
  if (frequency === "daily" || frequency === "weekly") {
    const intervalMs = frequency === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    let endAt = null;
    let maxOccurrences = null;
    if (args.end_date) {
      const endParsed = parseWhen(args.end_date);
      if (endParsed.ok) {
        endAt = endParsed.runAt;
      }
    }
    if (typeof args.occurrences === "number" && args.occurrences > 0) {
      maxOccurrences = args.occurrences;
    }
    recurrence = { frequency, intervalMs, endAt, maxOccurrences, firedCount: 0 };
  }

  const jobId = jobs.enqueue({
    kind: "reminder",
    payload: {
      userId,
      channelId: args.channel_id || message.channelId,
      text: args.message,
      targets,
      createdBy: "chatbot",
      recurrence,
    },
    run_at: parsed.runAt,
  });

  let confirm = `Reminder set for <t:${Math.floor(parsed.runAt / 1000)}:S>.`;
  if (targets.length > 1) {
    confirm += ` Notifying ${targets.length} target(s).`;
  }
  if (recurrence) {
    const freqLabel = recurrence.frequency === "daily" ? "Daily" : "Weekly";
    confirm += ` Repeats ${freqLabel}`;
    if (recurrence.endAt) {
      confirm += ` until <t:${Math.floor(recurrence.endAt / 1000)}:F>`;
    } else if (recurrence.maxOccurrences) {
      confirm += ` for ${recurrence.maxOccurrences} occurrence(s)`;
    }
    confirm += ".";
  }

  return {
    success: true,
    message: confirm,
    reminder_id: jobId,
  };
}

async function handleLookupKb(args, message, client) {
  if (!args?.query) return { error: "Missing required 'query' argument." };
  const guild = message.guild;
  if (!guild) return { error: "Knowledge base is only available in servers." };

  try {
    const { embedding } = await embed({ text: args.query });
    const results = kbStore.search(guild.id, embedding, 3);
    if (results.length === 0) {
      return { results: [], message: "No matching knowledge base entries found." };
    }
    return {
      results: results.map((r, i) => ({
        result_index: i + 1,
        slug: r.slug,
        title: r.title,
        content: r.content.length > 500 ? r.content.slice(0, 500) + "..." : r.content,
      })),
    };
  } catch (err) {
    logger.error(`[lookup_kb] ${err.message}`);
    return { error: `Knowledge base lookup failed: ${err.message}` };
  }
}

function buildFTSQuery(rawQuery) {
  const stopwords = new Set([
    "the","a","an","is","was","were","are","be","been","i","you","he","she",
    "they","we","it","that","this","what","did","do","does","how","when",
    "where","why","who","not","no","but","and","or","if","then","so","my",
    "your","his","her","their","our","its","at","in","on","for","of","to",
    "with","by","from","about","said","say","says","have","has","had",
    "would","could","should","will","can","may","might","let","get","got",
    "make","made","know","think","want","just","like","went","come","came",
    "go","see","saw","tell","told","ask","asked","very","really","thing",
  ]);
  const cleaned = rawQuery.replace(/["'()*^]/g, " ");
  const tokens = cleaned
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopwords.has(t));
  if (tokens.length === 0) return cleaned.trim() || rawQuery;
  return tokens.join(" OR ");
}

async function handleSearchHistory(args, message, client) {
  if (!args?.query) return { error: "Missing required 'query' argument." };
  const limit = Math.min(Math.max(args.limit || 5, 1), 10);
  const channelId = message.channelId;

  try {
    const ftsQuery = buildFTSQuery(args.query);
    const ftsResults = messageArchive.searchFTS(channelId, ftsQuery, 30);
    if (ftsResults.length === 0) {
      try {
        const { embedding } = await embed({ text: args.query });
        const semanticResults = messageArchive.searchSemanticFull(channelId, embedding, limit);
        if (semanticResults.length > 0) {
          return {
            results: semanticResults.map((r, i) => ({
              result_index: i + 1,
              message_id: r.message_id,
              author_id: r.author_id,
              content: r.content.length > 300 ? r.content.slice(0, 300) + "..." : r.content,
              created_at: r.created_at ? `<t:${Math.floor(r.created_at / 1000)}:R>` : "unknown",
            })),
            total_matches: semanticResults.length,
            note: "Results via semantic search (no FTS matches).",
          };
        }
      } catch (err) {
        logger.warn(`[search_history] Semantic fallback failed: ${err.message}`);
      }
      return {
        results: [],
        total_matches: 0,
        note: "No matches in this channel's history for that query. Do not retry with paraphrases — answer from prior context or state that you do not have a record.",
      };
    }

    let finalResults = ftsResults.slice(0, limit);
    const topRank = ftsResults[0]?.rank;
    const needsSemantic = topRank > 1.0 || ftsResults.length < limit;

    if (needsSemantic) {
      try {
        const { embedding } = await embed({ text: args.query });
        const candidateIds = ftsResults.map(r => r.id);
        const semanticResults = messageArchive.searchSemantic(channelId, embedding, candidateIds, limit);
        if (semanticResults.length > 0) {
          finalResults = semanticResults;
        }
      } catch (err) {
        logger.warn(`[search_history] Semantic re-rank failed: ${err.message}`);
      }
    }

    const out = {
      results: finalResults.map((r, i) => ({
        result_index: i + 1,
        message_id: r.message_id,
        author_id: r.author_id,
        content: r.content.length > 300 ? r.content.slice(0, 300) + "..." : r.content,
        created_at: r.created_at ? `<t:${Math.floor(r.created_at / 1000)}:R>` : "unknown",
      })),
      total_matches: ftsResults.length,
    };
    if (finalResults.length < limit) {
      out.note = "These are all matches for this query. Do not re-query with variations — synthesize from these results.";
    }
    return out;
  } catch (err) {
    logger.error(`[search_history] ${err.message}`);
    return { error: `Message history search failed: ${err.message}` };
  }
}

async function handleRecallEpisode(args, message) {
  if (!args?.query) return { error: "Missing required 'query' argument." };
  const scope = args.scope || "both";
  const limit = Math.min(Math.max(args.limit || 5, 1), 10);

  const scopePairs = [];
  if (scope === "channel" || scope === "both") {
    scopePairs.push({ scopeType: "channel", scopeId: message.channelId });
  }
  if (scope === "user" || scope === "both") {
    scopePairs.push({ scopeType: "user", scopeId: message.author.id });
  }
  if (scopePairs.length === 0) return { error: "Invalid scope value." };

  try {
    const ftsQuery = buildFTSQuery(args.query);
    const ftsResults = episodes.searchFTS(scopePairs, ftsQuery, 30);

    if (ftsResults.length === 0) {
      try {
        const { embedding } = await embed({ text: args.query });
        // Apply a relevance floor: searchSemanticFull always returns the
        // closest episodes regardless of how weak the match is, so without
        // this an unrelated query surfaces irrelevant episodes instead of an
        // empty result. See EPISODE_RECALL_MIN_SCORE in config.js.
        const semanticResults = episodes
          .searchSemanticFull(scopePairs, embedding, limit)
          .filter(r => r.score >= EPISODE_RECALL_MIN_SCORE);
        if (semanticResults.length > 0) {
          return {
            results: semanticResults.map((r, i) => ({
              result_index: i + 1,
              scope: r.scope_type,
              summary: r.summary,
              tags: r.tags ? JSON.parse(r.tags) : [],
              source: r.source,
              occurred_at: `<t:${Math.floor(r.created_at / 1000)}:R>`,
            })),
            note: "Results via semantic search (no FTS matches).",
          };
        }
      } catch (err) {
        logger.warn(`[recall_episode] Semantic fallback failed: ${err.message}`);
      }
      return {
        results: [],
        note: "No episodes found for that query. Do not retry with paraphrases.",
      };
    }

    let finalResults = ftsResults.slice(0, limit);
    const topRank = ftsResults[0]?.rank;
    const needsSemantic = topRank > 1.0 || ftsResults.length < limit;

    if (needsSemantic) {
      try {
        const { embedding } = await embed({ text: args.query });
        const candidateIds = ftsResults.map(r => r.id);
        const reranked = episodes.searchSemantic(embedding, candidateIds, limit);
        if (reranked.length > 0) finalResults = reranked;
      } catch (err) {
        logger.warn(`[recall_episode] Semantic re-rank failed: ${err.message}`);
      }
    }

    return {
      results: finalResults.map((r, i) => ({
        result_index: i + 1,
        scope: r.scope_type,
        summary: r.summary,
        tags: r.tags ? JSON.parse(r.tags) : [],
        source: r.source,
        occurred_at: `<t:${Math.floor(r.created_at / 1000)}:R>`,
      })),
      total_matches: ftsResults.length,
    };
  } catch (err) {
    logger.error(`[recall_episode] ${err.message}`);
    return { error: `Episode recall failed: ${err.message}` };
  }
}

function describeCommand(command) {
  const data = command.data;
  const options = (data.options || []).map(opt => {
    const json = typeof opt.toJSON === "function" ? opt.toJSON() : opt;
    return {
      name: json.name,
      description: json.description,
      required: !!json.required,
      type: json.type,
    };
  });
  const usage = options.length
    ? `/${data.name} ${options.map(o => o.required ? `<${o.name}>` : `[${o.name}]`).join(" ")}`
    : `/${data.name}`;
  return {
    name: data.name,
    description: data.description,
    usage,
    options,
  };
}

function describeExplanation(key) {
  const ex = explanations[key];
  if (!ex) return null;
  const out = { key, name: ex.name, description: ex.description?.trim?.() || ex.description };
  if (ex.rules) out.rules = ex.rules.trim?.() || ex.rules;
  if (ex.example) out.example = ex.example.trim?.() || ex.example;
  if (ex.note) out.note = ex.note.trim?.() || ex.note;
  return out;
}

function findFuzzyMatches(query, names) {
  const q = query.toLowerCase().replace(/^\//, "");
  const prefix = names.filter(n => n.toLowerCase().startsWith(q));
  if (prefix.length) return prefix;
  return names.filter(n => n.toLowerCase().includes(q));
}

async function handleGetCommandHelp(args, message, client) {
  if (!args?.name || typeof args.name !== "string") {
    return { error: "Missing required 'name' argument." };
  }
  const raw = args.name.trim().toLowerCase().replace(/^\//, "");
  if (!raw) return { error: "Empty 'name' argument." };

  try {
    const commands = client?.slashcommands;
    const explanationKeys = Object.keys(explanations);

    if (commands?.has?.(raw)) {
      const out = { match_type: "command", ...describeCommand(commands.get(raw)) };
      const ex = describeExplanation(raw);
      if (ex) out.explanation = ex;
      return out;
    }

    if (explanations[raw]) {
      return { match_type: "explanation", ...describeExplanation(raw) };
    }

    const commandNames = commands ? Array.from(commands.keys()) : [];
    const cmdFuzzy = findFuzzyMatches(raw, commandNames);
    if (cmdFuzzy.length === 1) {
      const out = { match_type: "command", resolved_from: raw, ...describeCommand(commands.get(cmdFuzzy[0])) };
      const ex = describeExplanation(cmdFuzzy[0]);
      if (ex) out.explanation = ex;
      return out;
    }

    const exFuzzy = findFuzzyMatches(raw, explanationKeys);
    if (cmdFuzzy.length === 0 && exFuzzy.length === 1) {
      return { match_type: "explanation", resolved_from: raw, ...describeExplanation(exFuzzy[0]) };
    }

    const candidates = [...new Set([...cmdFuzzy, ...exFuzzy])].slice(0, 5);
    if (candidates.length > 0) {
      return {
        match_type: "ambiguous",
        candidates,
        note: `Multiple matches for "${raw}". Re-call get_command_help with one of the candidate names.`,
      };
    }

    return {
      match_type: "not_found",
      query: raw,
      available_commands: commandNames,
      available_explanations: explanationKeys,
      note: `No command or explanation matches "${raw}".`,
    };
  } catch (err) {
    logger.error(`[get_command_help] ${err.message}`);
    return { error: `Command help lookup failed: ${err.message}` };
  }
}

async function handleGetJackpot(args, message, client) {
  try {
    const jackpot = await getJackpot();
    const out = {
      amount: jackpot.amount,
      display: `${jackpot.amount.toLocaleString()} koku`,
      min_bet_eligible: JACKPOT_MIN_BET,
      contribution_rate_percent: Math.round(JACKPOT_RATE * 10000) / 100,
      last_winner: null,
    };
    if (jackpot.lastWinner && jackpot.lastWon) {
      out.last_winner = {
        user_id: jackpot.lastWinner.id,
        name: jackpot.lastWinner.name,
        amount_won: jackpot.lastWinner.wonAmount,
        won_at: `<t:${Math.floor(jackpot.lastWon / 1000)}:R>`,
      };
    }
    return out;
  } catch (err) {
    logger.error(`[get_jackpot] ${err.message}`);
    return { error: `Jackpot lookup failed: ${err.message}` };
  }
}

async function handleGetShop(args, message, client) {
  const guildId = message.guild?.id;
  if (!guildId) return { error: "This tool can only be called from within a guild." };

  try {
    const stock = getDailyShopStock(guildId);
    const resetEpoch = nextShopResetEpoch();

    return {
      items: stock.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        category: item.category,
        tier: item.tier,
        rarity: item.rarity,
        price: item.price,
        price_display: formatPrice(item.price),
      })),
      resets_at: `<t:${resetEpoch}:T>`,
      note: stock.length === 0
        ? "The shop is currently empty."
        : "These items reset daily at midnight UTC.",
    };
  } catch (err) {
    logger.error(`[get_shop] ${err.message}`);
    return { error: `Shop lookup failed: ${err.message}` };
  }
}

async function handleWebSearch(args, message) {
  const count = Math.min(Math.max(args.count || 5, 1), 10);
  const isNsfw = message?.channel?.nsfw || message?.channel?.parent?.nsfw;
  const safesearch = isNsfw ? "" : "&safesearch=strict";
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${count}&result_filter=web${safesearch}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
      signal: controller.signal,
    });
    if (!res.ok) return { error: `Brave Search API returned HTTP ${res.status}.` };
    const data = await res.json();
    const results = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description || "",
    }));
    if (results.length === 0) return { results: [], message: "No web results found." };
    return { results, query: args.query };
  } catch (err) {
    const reason = err.name === "AbortError" ? "Search timed out after 10s." : err.message;
    logger.error(`[web_search] ${reason}`);
    return { error: `Web search failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

async function handleFetchPage(args) {
  const result = await fetchPageText(args.url, 4000);
  if (result.error) return { error: result.error };
  return { title: result.title, text: result.text, url: result.url };
}

function formatGameResultForLlm(row) {
  const ts = `<t:${Math.floor(row.played_at / 1000)}:R>`;
  const r = row.result;
  const base = { game: row.game, played_at: ts };

  if (row.game === "slots") {
    return {
      ...base,
      grid: Array.isArray(r.grid) ? r.grid : null,
      active_lines: r.active_lines,
      winning_lines: r.winning_lines || [],
      bet_per_line: r.bet_per_line,
      total_cost: r.total_cost,
      total_payout: r.total_payout,
      net: r.net,
      outcome: r.outcome,
      is_jackpot: r.is_jackpot,
      jackpot_amount: r.jackpot_amount,
      is_fullscreen: r.is_fullscreen,
      is_bonus: r.is_bonus,
      is_free: r.is_free,
      bonus_triggered: r.bonus_triggered,
    };
  }

  if (row.game === "blackjack") {
    return {
      ...base,
      player_hands: r.player_hands ?? (r.player_hand ? [{ ...r.player_hand, bet: r.total_bet, outcome: r.outcome, doubled: false }] : null),
      dealer_hand: r.dealer_hand,
      total_bet: r.total_bet,
      payout: r.payout,
      net: r.net,
      outcome: r.outcome,
      dealer_blackjack: r.dealer_blackjack || false,
    };
  }

  if (row.game === "roulette") {
    return {
      ...base,
      winning_number: r.winning_number,
      color: r.color,
      bets: r.bets,
      total_wagered: r.total_wagered,
      total_payout: r.total_payout,
      net: r.net,
    };
  }

  if (row.game === "craps") {
    return {
      ...base,
      dice: r.dice,
      roll_type: r.roll_type,
      phase: r.phase_before,
      point: r.point,
      bets: r.bets,
      total_wagered: r.total_wagered,
      net: r.net,
    };
  }

  if (row.game === "race") {
    return {
      ...base,
      finish_order: r.finish_order,
      bets: r.bets,
      net: r.net,
    };
  }

  if (row.game === "poker") {
    return {
      ...base,
      final_hand: r.final_hand,
      hand_name: r.hand_name,
      bet: r.bet,
      payout: r.payout,
      net: r.net,
      outcome: r.outcome,
      is_jackpot: r.is_jackpot,
    };
  }

  if (row.game === "flip") {
    return {
      ...base,
      bet: r.bet,
      roll: r.roll,
      outcome: r.outcome,
      payout: r.payout,
      net: r.net,
    };
  }

  if (row.game === "rob") {
    return {
      ...base,
      victim_id: r.victim_id,
      amount: r.amount,
      outcome: r.outcome,
      net: r.net,
    };
  }

  if (row.game === "duel") {
    return {
      ...base,
      challenger_id: r.challenger_id,
      opponent_id: r.opponent_id,
      challenger_choice: r.challenger_choice,
      opponent_choice: r.opponent_choice,
      bet: r.bet,
      outcome: r.outcome,
      payout: r.payout,
      net: r.net,
    };
  }

  return { ...base, raw: r };
}

async function handleGetGameResult(args, message) {
  try {
    const channelId = message.channelId;
    if (!channelId) return { error: "Could not determine channel." };

    let userId = message.author?.id;
    if (args.user_id) {
      const member = await resolveMember(args.user_id, message.guild);
      if (member) userId = member.user.id;
    }
    if (!userId) return { error: "Could not resolve user." };

    const row = gameResults.getLatestGameResult({ channelId, userId, game: args.game || null });
    if (!row) return { note: "No recent game results found for this user in this channel." };

    return formatGameResultForLlm(row);
  } catch (err) {
    logger.error(`[get_game_result] ${err.message}`);
    return { error: `Game result lookup failed: ${err.message}` };
  }
}

async function handleGetRecentGameResults(args, message) {
  try {
    const channelId = message.channelId;
    if (!channelId) return { error: "Could not determine channel." };

    let userId = null;
    if (args.user_id) {
      const member = await resolveMember(args.user_id, message.guild);
      userId = member ? member.user.id : args.user_id;
    }

    const limit = Math.min(Math.max(args.limit || 5, 1), 10);
    const rows = gameResults.getRecentGameResults({ channelId, userId, game: args.game || null, limit });
    if (rows.length === 0) return { note: "No recent game results found.", results: [] };

    return { results: rows.map(formatGameResultForLlm) };
  } catch (err) {
    logger.error(`[get_recent_game_results] ${err.message}`);
    return { error: `Game results lookup failed: ${err.message}` };
  }
}

async function handleProposeKbEntry(args, message, client) {
  const guild = message.guild;
  if (!guild) return { error: "The knowledge base is only available in servers." };

  const title = (args.title || "").trim();
  const body = (args.body || "").trim();
  if (title.length < 2 || title.length > 100) return { error: "Title must be 2–100 characters." };
  if (body.length < 2 || body.length > 4000) return { error: "Body must be 2–4000 characters." };

  const tags = Array.isArray(args.tags) && args.tags.length
    ? args.tags.map(t => String(t).trim()).filter(Boolean).join(", ").slice(0, 200) || null
    : null;

  try {
    const proposal = kbProposals.create({
      guildId: guild.id,
      title,
      content: body,
      tags,
      source: "tool",
      originUserId: message.author?.id || null,
    });
    if (!proposal) {
      return { note: "A matching entry is already pending the owner's review — no need to propose it again." };
    }
    await kbProposals.notifyOwnerOfProposal(client, proposal);
    return {
      success: true,
      message: `Proposed "${title}" to the knowledge base. It is pending the owner's approval before it goes live.`,
    };
  } catch (err) {
    logger.error(`[propose_kb_entry] ${err.message}`);
    return { error: `Could not submit the proposal: ${err.message}` };
  }
}

const TOOL_HANDLERS = {
  get_balance: handleGetBalance,
  get_leaderboard: handleGetLeaderboard,
  get_user_stats: handleGetUserStats,
  get_guild_info: handleGetGuildInfo,
  get_user_info: handleGetUserInfo,
  get_bot_info: handleGetBotInfo,
  generate_image: handleGenerateImage,
  set_reminder: handleSetReminder,
  lookup_kb: handleLookupKb,
  search_history: handleSearchHistory,
  get_jackpot: handleGetJackpot,
  get_shop: handleGetShop,
  get_command_help: handleGetCommandHelp,
  recall_episode: handleRecallEpisode,
  propose_kb_entry: handleProposeKbEntry,
  web_search: handleWebSearch,
  fetch_page: handleFetchPage,
  get_game_result: handleGetGameResult,
  get_recent_game_results: handleGetRecentGameResults,
};

function normalizeArgs(args) {
  if (!args || typeof args !== "object") return JSON.stringify(args ?? null);
  const out = {};
  for (const key of Object.keys(args).sort()) {
    const v = args[key];
    if (typeof v === "string") {
      out[key] = v.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).sort().join(" ");
    } else {
      out[key] = v;
    }
  }
  return JSON.stringify(out);
}

async function executeToolCall(toolCall, message, client, toolCtx = null) {
  const fnName = toolCall.function.name;
  const fnArgs = JSON.parse(toolCall.function.arguments || "{}");

  logger.log(`[ToolCall] ${fnName}(${JSON.stringify(fnArgs)})`);

  const argCheck = validateToolArgs(fnName, fnArgs);
  if (!argCheck.valid) {
    logger.warn(`[ToolCall] ${fnName} invalid_arguments: ${argCheck.errors}`);
    return { error: "invalid_arguments", details: argCheck.errors };
  }

  const cacheable = toolCtx?.queryCache && !SIDE_EFFECT_TOOLS.has(fnName);
  const cacheKey = cacheable ? `${fnName}:${normalizeArgs(fnArgs)}` : null;
  if (cacheable && toolCtx.queryCache.has(cacheKey)) {
    const cached = toolCtx.queryCache.get(cacheKey);
    logger.log(`[ToolCall] Dedup hit ${cacheKey}`);
    const dedupNote = "Duplicate query — synthesize from the prior tool message for this call.";
    const cloned = { ...cached };
    cloned.note = cloned.note ? `${cloned.note} ${dedupNote}` : dedupNote;
    return cloned;
  }

  let result;
  try {
    const handler = TOOL_HANDLERS[fnName];
    if (!handler) {
      result = { error: `Unknown function: ${fnName}` };
    } else {
      result = await handler(fnArgs, message, client, toolCtx);
    }
  } catch (err) {
    logger.error(`[ToolCall] Error in ${fnName}: ${err.message}`);
    result = { error: err.message };
  }

  if (cacheable) toolCtx.queryCache.set(cacheKey, result);

  logger.debug(`[ToolCall] Result: ${JSON.stringify(result)}`);
  return result;
}

module.exports = { TOOLS, executeToolCall, SIDE_EFFECT_TOOLS };