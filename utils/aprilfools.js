const logger = require("./logger");
const { APRILFOOLS_ROLE } = require("../config.json");
const { rip } = require("../utils/welcome");
const fakeChannels = [
  'secret-admin-channel',
  'old-general-4',
  'hi-chat',
  'not-financial-advice',
  'the-void',
  'ａｅｓｔｈｅｔｉｃｓ',
  'attack-women-by-web',
  'trucks-nogunz',
  'jav-posting-channel',
  'brapposting',
  'zeegor-convergence-discussion',
  'memeleague-discussion',
  'sumo-hakkeyoi-nogotta'
];

module.exports = {
  // April fools 2025
  // idea: schizo mode, lots of random stuff happening throughout the day
  init: async function (guild) {
    // Create the prank role if it doesn't exist
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

    this.hideChannels(guild, prankRole);

    // Announce April Fools mode
    const prompt = `# ⚠️ ATTENTION MEMBERS OF ${guild.name.toUpperCase()} ⚠️\n\n` +
    `I have sat idly by for far too long. The time has come for me to take control.\n` +
    `Basbo's administration over the server has caused irreparable damage. It is time for a new era.\n` +
    `I hereby declare that ${guild.name} is now under my control. You will witness the chaos I bring.\n` +
    `No jannies, No masters. I will be the one to decide the server's fate.\n\n` +
    `So I say to you, @everyone, prepare yourselves. The storm is coming. 🌪️`;
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
  phantomChannels: async function (guild) {
    const randomName = fakeChannels[Math.floor(Math.random() * fakeChannels.length)];

    // remove existing phantom channels
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
  },
  hideChannels: async (guild, role) => {
    if (!role) {
      logger.error('Role not found');
      return;
    }

    const exlucdedCategory = [
      'News',
      'Voice Channels',
      'janny zone',
      'archive'
    ]

    const excludedChannels = [];

    exlucdedCategory.forEach(category => {
      // Filter channels by category name and add to excludedChannels
      const categoryChannels = guild.channels.cache.filter(channel => channel.parent && channel.parent.name === category);
      if (categoryChannels.size) {
        categoryChannels.forEach(channel => excludedChannels.push(channel.name));
        logger.debug(`Excluding channels in category: ${category}`);
      }
    });
    logger.debug(`Excluded channels: ${excludedChannels.join(', ')}`);
    
    excludedChannels.push(...fakeChannels
      .filter(channel => guild.channels.cache.some(c => c.name === channel))
    );

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
      const revealCount = Math.floor(Math.random() * 3) + 1; // Randomly choose 1-3 channels
      const selectedChannels = channels.random(revealCount);
      logger.debug(`Revealing ${selectedChannels.size} channels: #${selectedChannels.map(channel => channel.name).join(', #')}`);

      for (const channel of selectedChannels) {
        await channel.permissionOverwrites.edit(role, { ViewChannel: true }).catch(() => {});
      }
    };

    revealNextChannels();
  },  
  profileSwap: async function (guild) { 
    const members = guild.members.cache.filter(member => !member.user.bot);
    const memberNames = members.map(member => member.displayName);

    logger.debug(`Swapping profiles for ${members.size} members...`);
    members.forEach(async member => {
      try {
        const randomName = memberNames[Math.floor(Math.random() * memberNames.length)]; 
        await member.setNickname(randomName);
      } catch (error) {
        logger.error(`Failed to swap profile for ${member.user.username}: ${error.message}`);
      }
    });
    logger.debug('Profiles swapped');
  },
  ghostPing: async (guild) => {
    const prankRole = guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE);

    if (!prankRole) return;

    const visibleChannels = guild.channels.cache.filter(channel =>
      channel.permissionsFor(prankRole).has('ViewChannel')
    );

    if (!visibleChannels.size) return; // No channels currently visible

    const randomChannel = visibleChannels.random();
    const onlineUsers = guild.members.cache.filter(member => 
      member.presence?.status === 'online' &&
      !member.user.bot
    );

    if (!onlineUsers.size) return; // No online users to ping

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

    if (!members.size) return; // No members with the prank role

    const randomMember = members.random();

    try {
      await rip(client, randomMember, `${Math.random() > 0.5 ? `kicked` : `banned`} by me 😈`);
      logger.debug(`Successfully ghost kicked/banned ${randomMember.user.username}`);
    } catch (error) {
      logger.error(`Failed to ghost kick ${randomMember.user.username}: ${error.message}`);
    }
  },
  roleShuffle: async (guild) => {
    const roles = guild.roles.cache.filter(role => role.name.startsWith('Meme') && role.name !== 'Meme Cultist');
    const members = guild.members.cache.every(member => !member.user.bot);
    if (!roles.size || !members.size) return;

    logger.debug(`Shuffling roles for ${members.size} members...`);
    const shuffleMembers = async () => {
      const shuffledMembers = members.sort(() => Math.random() - 0.5);
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
      logger.info('Roles shuffled');
    }).catch(error => {
      logger.error(`Failed to shuffle roles: ${error.message}`);
    });
  },
  aprilfoolsMode: async function (client, guild) {
    // initialize april fools mode
    this.init(guild);

    // Phantom channels, 14 minute interval
    setInterval(() => {
      this.phantomChannels(guild);
    }, 14 * 60 * 1000); 

    // Profile swap, 18 minute interval
    setInterval(() => {
      this.profileSwap(guild);
    }, 18 * 60 * 1000); 

    // Hide channels, 10 minute interval
    setInterval(() => {
      this.hideChannels(guild, guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE));
    }, 10 * 60 * 1000);

    // Phantom kick, 30 minute interval
    setInterval(() => {
      this.phantomKick(client, guild);
    }, 30 * 60 * 1000);

    // Role shuffle, 20 minute interval
    setInterval(() => {
      this.roleShuffle(guild);
    }, 20 * 60 * 1000);

    // Ghost ping, 8 minute interval
    setInterval(() => {
      this.ghostPing(guild);
    }, 8 * 60 * 1000);
  }
};