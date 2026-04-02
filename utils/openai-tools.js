const { QuickDB } = require("quick.db");
const usersDb = new QuickDB({ filePath: `./db/users.sqlite` });
const logger = require("./logger");
const { getCurrentTopUsers, getAllTimeTopUsers } = require("./bank");
const { CURRENCY_NAME } = require("../config.js");

// Tool definitions for DeepSeek function calling
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_balance",
      description: "Get a user's wallet and bank balance. Call when user asks about their or someone else's money.",
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
      description: "Get the top users by bank balance. Call when user asks about rankings, leaderboards, or richest users.",
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
      description: "Get a user's game statistics, command usage, and other stats. Call when user asks about their or someone's stats.",
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
      description: "Get information about the current Discord server (guild). Call when user asks about the server, its channels, roles, or member count.",
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
      description: "Get detailed information about a Discord user including their roles, join date, and avatar. Call when user asks about someone's Discord profile.",
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
      description: "Get information about this bot's capabilities and available commands. Call when user asks what the bot can do, what commands are available, or how to use specific features.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

// Helper to resolve a user ID or username to a guild member
async function resolveMember(input, guild) {
  if (!input) return null;

  // If it looks like a Discord snowflake ID (17-19 digits)
  if (/^\d{17,19}$/.test(input)) {
    return guild.members.fetch(input).catch(() => null);
  }

  // Otherwise, search by display name, username, or nickname
  const searchName = input.toLowerCase().replace(/^@/, '');
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

  const totalCommands = Object.values(stats.commands?.total || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

  const gameStats = {};
  const gameKeys = ['blackjack', 'slots', 'flip', 'roulette', 'race', 'begs'];
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
      .filter(r => r.name !== '@everyone')
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

const TOOL_HANDLERS = {
  get_balance: handleGetBalance,
  get_leaderboard: handleGetLeaderboard,
  get_user_stats: handleGetUserStats,
  get_guild_info: handleGetGuildInfo,
  get_user_info: handleGetUserInfo,
  get_bot_info: handleGetBotInfo
};

async function executeToolCall(toolCall, message, client) {
  const fnName = toolCall.function.name;
  const fnArgs = JSON.parse(toolCall.function.arguments || "{}");

  logger.log(`[ToolCall] ${fnName}(${JSON.stringify(fnArgs)})`);

  let result;
  try {
    const handler = TOOL_HANDLERS[fnName];
    if (!handler) {
      result = { error: `Unknown function: ${fnName}` };
    } else {
      result = await handler(fnArgs, message, client);
    }
  } catch (err) {
    logger.error(`[ToolCall] Error in ${fnName}: ${err.message}`);
    result = { error: err.message };
  }

  logger.debug(`[ToolCall] Result: ${JSON.stringify(result)}`);
  return result;
}

module.exports = { TOOLS, executeToolCall };