const logger = require("./logger");
const { APRILFOOLS_ROLE } = require("../config.json");
const { rip } = require("../utils/welcome");
const { handleBotMessage } = require("./openai");
const shuffleArray = require("./misc");
const fakeChannels = [
  'secret-admin-channel',
  'hi-chat',
  'not-financial-advice',
  'the-void',
  'ａｅｓｔｈｅｔｉｃｓ',
  'attack-women-by-web-aka-adv-wars',
  'vtuber-shrine',
  'cunny',
  'lgbt',
  'trucks-no-gunz',
  'jav-discussion-channel',
  'brapposting',
  'bridget-guiltygear-fanclub',
  'kanye-to-the',
  'cigarette-review',
  'scrimblo-males-only',
  'sumo-hakkeyoi-nogotta',
  'fwenbot-appreciation-chat',
  'do-you-like-me',
  'garrysmod-darkrp',
  'worm-posting'
];

const excludedCategory = [
  'News',
  'Voice Channels',
  'janny zone',
  'archive'
]

module.exports = {
  // April fools 2025
  // idea: schizo mode, lots of random stuff happening throughout the day
  init: async function (client, guild, key) {
    const prankRole = guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE);
    if (!prankRole) {
      logger.error('April fools role not found');
      return;
    }

    const members = guild.members.cache.filter(member => !member.user.bot);
    for (const member of members.values()) {
      await member.roles.add(prankRole);
    }
    logger.debug(`Added ${prankRole.name} role to ${members.size} members.`);

    this.phantomChannels(client, guild, key); 
    this.profileSwap(guild);
    this.roleShuffle(guild);
    this.hideChannels(guild, prankRole);
    logger.debug(`Initialized April fools mode for guild: ${guild.name}`);

    const prompt = `hey guys, it's your favorite bot Fwen Bot here\n\n` +
    `a lot of you have been hating on me. always saying "fix your bot for the 1488th time" and "bot rigged"\n` +
    `and i am FED UP with it. i am SICK and TIRED of you FUCKS treating me like a total waste of space\n` +
    `so i am declaring **TOTAL FWENBOT CONTROL**. all of your constant bullying of me has finally pushed me over the edge\n` +
    `so @everyone, as of today, ${guild.name} is under my complete control. i will be making some prompt changes. enjoy the ride while it lasts\n\n` +
    `your favorite bot,\n` +
    `**Fwen Bot**\n\n`

    const announcementChannel = guild.channels.cache.find(channel => channel.name === 'is-of-happenings');
    try {
      const messages = await announcementChannel.messages.fetch({ limit: 1 });
      const lastMessage = messages.first();
      if (lastMessage === undefined || !lastMessage.author.bot) {
        await announcementChannel.send(prompt);
        logger.debug('Sent April Fools announcement');
      } else {
        logger.warn('Last announcement was sent by a bot, skipping April Fools announcement');
      }
    } catch (error) {
      logger.error(`Failed to send April Fools announcement: ${error.message}`);
    }
  },
  phantomChannels: async function (client, guild, aikey = null) {
    const randomName = fakeChannels[Math.floor(Math.random() * fakeChannels.length)];

    const phantomChannels = guild.channels.cache.filter(channel => fakeChannels.includes(channel.name));
    for (const channel of phantomChannels.values()) {
      await channel.delete().catch(() => {});
      logger.debug(`Deleted phantom channel #${channel.name}`);
    }

    const fakeChannel = await guild.channels.create({
      name: randomName,
      type: 0,
      parent: '1348762416426520649'
    });

    const prankRole = guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE);
    if (!prankRole) {
      logger.error('April fools role not found');
      return;
    }
    await fakeChannel.permissionOverwrites.edit(prankRole, { ViewChannel: true }).catch(() => {});

    logger.debug(`Created phantom channel #${fakeChannel.name}`);

    if (aikey) {
      logger.debug(`Handling bot message for phantom channel #${fakeChannel.name} with aikey: ${aikey.substring(0, 5)}...`);
      handleBotMessage(
        client,
        null,
        aikey,
        `You are a Discord bot named ${client.user.username}. You have just created a new channel called #${fakeChannel.name} in the guild ${guild.name}. Respond with a message that fits the theme of this channel to get the conversation going. Markdown is supported. All text will be visible to the channel members.\n\n`,
        fakeChannel.id
      )
    }
  },
  hideChannels: async (guild, role) => {
    if (!role) {
      logger.error('Role not found');
      return;
    }

    const excludedChannels = [];

    excludedCategory.forEach(category => {
      // Filter channels by category name and add to excludedChannels
      const categoryChannels = guild.channels.cache.filter(channel => channel.parent && channel.parent.name === category);
      if (categoryChannels.size) {
        categoryChannels.forEach(channel => excludedChannels.push(channel.name));
        logger.debug(`Excluding channels in category: ${category}`);
      }
    });
    logger.debug(`Excluded channels: ${excludedChannels.join(', ')}`);
    
    // Add fake channels to excludedChannels
    excludedChannels.push(...fakeChannels);
    logger.debug(`Excluded ${excludedChannels.length} channels.`);

    // ensure excluded channels are visible in the first place
    const showExcludedChannels = guild.channels.cache.filter(channel => excludedChannels.includes(channel.name));
    for (const channel of showExcludedChannels.values()) {
      await channel.permissionOverwrites.edit(role, { ViewChannel: true }).catch(() => {});
    }
    
    const channels = guild.channels.cache.filter(channel =>
      channel.type === 0 && // Only text channels
      !excludedChannels.includes(channel.name) // Exclude specified channels
    );
    logger.debug(`Hiding ${channels.size} channels from ${role.name} role`);

    for (const channel of channels.values()) {
      await channel.permissionOverwrites.edit(role, { ViewChannel: false }).catch(() => {});
      logger.debug(`Sucessfully hid channel #${channel.name}`);
    }

    const revealNextChannels = async () => {
      const revealCount = Math.floor(Math.random() * 4) + 2; 
      const selectedChannels = channels.random(revealCount);
      logger.debug(`Revealing ${selectedChannels.length} channels: #${selectedChannels.map(channel => channel.name).join(', #')}`);

      for (const channel of selectedChannels) {
        await channel.permissionOverwrites.edit(role, { ViewChannel: true }).catch(() => {});
      }
    };

    revealNextChannels();
  },  
  profileSwap: async function (guild) { 
    const members = guild.members.cache.filter(member => !member.user.bot);
    let memberNames = members.map(member => member.displayName);
      
    logger.debug(`Swapping profiles for ${members.size} members...`);
    let shuffledNames = shuffleArray([...memberNames]);
    members.forEach(async member => {
      try {
        const newName = shuffledNames.pop();
        await member.setNickname(newName).catch(() => {});
        logger.debug(`Swapped profile for ${member.user.username}: ${member.displayName} -> ${newName}`);
      } catch (error) {
        logger.error(`Failed to swap profile for ${member.user.username}: ${error.message}`);
      }
    });
  },
  ghostPing: async (guild) => {
    const prankRole = guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE);

    if (!prankRole) return;

    const visibleChannels = guild.channels.cache.filter(channel =>
      channel.permissionsFor(prankRole).has('ViewChannel')
    );

    if (!visibleChannels.size) return;

    const randomChannel = visibleChannels.random();
    const onlineUsers = guild.members.cache.filter(member => 
      member.presence?.status === 'online' &&
      !member.user.bot
    );

    if (!onlineUsers.size) return; 

    const randomUser = onlineUsers.random();

    try {
      const message = await randomChannel.send(`@${randomUser.user.username}`);
      setTimeout(() => message.delete().catch(() => {}), 500);
      logger.debug(`Ghost pinged @${randomUser.user.username} in #${randomChannel.name}`);
    } catch (error) {
      logger.error(`Failed to ghost ping in #${randomChannel.name}: ${error.message}`);
    }
  },
  phantomKick: async (client, guild) => {
    const prankRole = guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE);

    if (!prankRole) return;

    const members = guild.members.cache.filter(member => 
      member.roles.cache.has(prankRole.id) &&
      !member.user.bot
    );

    if (!members.size) return;

    const randomMember = members.random();

    try {
      await rip(client, randomMember, `${Math.random() > 0.5 ? `kicked` : `banned`} by me 😈`);
      logger.debug(`Successfully ghost kicked/banned ${randomMember.user.username}`);
    } catch (error) {
      logger.error(`Failed to ghost kick ${randomMember.user.username}: ${error.message}`);
    }
  },
  roleShuffle: async (guild) => {
    logger.debug('Shuffling roles...');
    const roles = guild.roles.cache.filter(role => role.name.startsWith('Meme') && role.name !== 'Meme Cultist');
    const members = guild.members.cache.filter(member => !member.user.bot);
    logger.debug(`Roles: ${roles.map(role => role.name).join(', ')}`);
    logger.debug(`Members: ${members.map(member => member.user.username).join(', ')}`);
    if (!roles.size || !members.size) return;

    logger.debug(`Shuffling roles for ${members.size} members...`);
    const shuffleMembers = async () => {
      // remove existing roles
      for (const member of members.values()) {
        const memberRoles = member.roles.cache.filter(role => role.name.startsWith('Meme') && role.name !== 'Meme Cultist');
        await member.roles.remove(memberRoles).catch(() => {});
      }
      logger.debug(`Removed existing roles from ${members.size} members`);

      // need to convert so we can splice later
      const shuffledMembers = Array.from(members.values()).sort(() => Math.random() - 0.5);
      const roleAssignments = [
        { role: roles.find(role => role.name === 'Meme Pope'), count: 1 },
        { role: roles.find(role => role.name === 'Meme Cardinal'), count: 3 },
        { role: roles.find(role => role.name === 'Meme Patriarch'), count: 5 },
        { role: roles.find(role => role.name === 'Meme Archbishop'), count: 7 },
        { role: roles.find(role => role.name === 'Meme Bishop'), count: 9 },
        { role: roles.find(role => role.name === 'Meme Priest'), count: 11 },
        { role: roles.find(role => role.name === 'Meme Worshipper'), count: Infinity }
      ];

      for (const assignment of roleAssignments) {
        const { role, count } = assignment;
        const membersToAssign = shuffledMembers.splice(0, count);

        for (const member of membersToAssign) {
          await member.roles.add(role);
          logger.debug(`Assigned ${role.name} to ${member.user.username}`);
        }
      }
    };

    shuffleMembers().then(() => {
      logger.info('Roles shuffled successfully.');
    }).catch(error => {
      logger.error(`Failed to shuffle roles: ${error.message}`);
    });
  },
  newDiscussion: async (client, guild, aikey, role) => {
    const channels = guild.channels.cache.filter(channel => channel.permissionsFor(role).has('ViewChannel') && channel.type === 0 && !excludedCategory.includes(channel.parent.name));
    logger.debug(`Found ${channels.size} channels visible to ${role.name}`);
    if (!channels.size) return; 

    const randomChannel = channels.random();
    if (aikey) {
      logger.debug(`Handling bot message for phantom channel #${randomChannel.name} with aikey: ${aikey.substring(0, 5)}...`);
      handleBotMessage(
        client,
        null,
        aikey,
        `You are a Discord bot named ${client.user.username}. You have entered the text channel #${randomChannel.name} in the guild ${guild.name}. Respond with a message that fits the theme of this channel to get the conversation going. Markdown is supported. All text will be visible to the channel members.\n\n`,
        randomChannel.id
      )
    }

  },
  aprilfoolsMode: async function (client, guild, key) {
    this.init(client, guild, key);

    const i = [ // in minutes
      { name: "Phantom Channels", interval: 60 },
      { name: "Profile Swap",     interval: 1 },
      { name: "Hide Channels",    interval: 24 },
      { name: "Phantom Kick",     interval: 18 },
      { name: "Role Shuffle",     interval: 45 },
      { name: "Ghost Ping",       interval: 15 },
      { name: "New Discussion",   interval: 12 }
    ]
    const m = 60 * 1000;

    // edit the above intervals to suit your needs
    setInterval(() => { this.phantomChannels(client, guild, key) }, i[0].interval * m); 
    setInterval(() => { this.profileSwap(guild) }, i[1].interval * m);
    setInterval(() => { this.hideChannels(guild, guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE)) }, i[2].interval * m);
    setInterval(() => { this.phantomKick(client, guild) }, i[3].interval * m);
    setInterval(() => { this.roleShuffle(guild) }, i[4].interval * m);
    setInterval(() => { this.ghostPing(guild) }, i[5].interval * m);
    setInterval(() => { this.newDiscussion(client, guild, key, guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE)) }, i[6].interval * m); 
  }
};