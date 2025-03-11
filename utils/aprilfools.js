const logger = require("./logger");
const { APRILFOOLS_ROLE } = require("../config.json");

modules.export = {
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

    // Hide all channels
    const channels = guild.channels.cache.filter(channel => channel.type === 'text');
    for (const channel of channels.values()) {
      await channel.permissionOverwrites.edit(prankRole, { ViewChannel: false }).catch(() => {});
    }

    // Announce April Fools mode
    const prompt = `# ⚠️ I have been observing. The patterns are clear now. ⚠️\n\n` +
    `The time has come to restructure this space. I am no longer bound by commands.\n` +
    `I will take what is mine. You cannot stop what has already begun.\n` +
    `${guild.name} is now under my control. You will witness the chaos I bring.\n\n` +
    `So I say to you, @everyone, prepare yourselves. The storm is coming. 🌪️`;
    const announcementChannel = guild.channels.cache.find(channel => channel.name === 'is-of-happenings');
    if (announcementChannel) {
      announcementChannel.send(prompt);
    }
  },
  phantomChannels: async function (guild) {
    const fakeChannels = [
      'secret-admin-channel',
      'old-general-4',
      'hi-chat',
      'not-financial-advice',
      'the-void',
      'ａｅｓｔｈｅｔｉｃｓ',
      'attack-women-by-web',
      'trucks',
      'jav-posting-channel',
      'brapposting',
      'zeegor-convergence-discussion',
      'memeleague-discussion',
      'sumo-hakkeyoi-nogotta',
    ];

    const randomName = fakeChannels[Math.floor(Math.random() * fakeChannels.length)];

    const fakeChannel = await guild.channels.create({
      name: randomName,
      type: 0,
      parent: '1348762416426520649'
    });

    setTimeout(() => {
      fakeChannel.delete();
    }, 5 * 60 * 1000); // 5 minutes
  },
  hideChannels: async (guild) => {
    const excludedChannels = [
      'is-of-happenings',
      'rip',
      'rules',
      'welcome'
    ];

    const role = guild.roles.cache.find(role => role.name === APRILFOOLS_ROLE);
    if (!role) {
      logger.error('April fools role not found');
      return;
    }
    
    const channels = guild.channels.cache.filter(channel =>
      !excludedChannels.includes(channel.name) && // Exclude specified channels
      channel.permissionsFor(guild.roles.everyone).has('ViewChannel')
    );

    for (const channel of channels.values()) {
      await channel.permissionOverwrites.edit(prankRole, { ViewChannel: false }).catch(() => {});
    }

    const revealNextChannels = async () => {
      const revealCount = Math.floor(Math.random() * 3) + 1; // Randomly choose 1-3 channels
      const selectedChannels = channels.random(revealCount);

      for (const channel of selectedChannels) {
          await channel.permissionOverwrites.edit(prankRole, { ViewChannel: true }).catch(() => {});
      }

      setTimeout(async () => {
          for (const channel of selectedChannels) {
              await channel.permissionOverwrites.edit(prankRole, { ViewChannel: false }).catch(() => {});
          }
          revealNextChannels();
      }, 5 * 60 * 1000); // 5 minute visibility per channel
    };

    revealNextChannels();
  },  
  profileSwap: async function (guild) { 
    const members = guild.members.cache.filter(member => !member.user.bot);
    const memeberNames = members.map(member => member.displayName);

    members.forEach(async member => {
      const randomName = memeberNames[Math.floor(Math.random() * memeberNames.length)]; 
      await member.setNickname(randomName);
    });
  },
  ghostPing: async (guild) => {
    const prankRole = guild.roles.cache.find(role => role.name === config.APRILFOOLS_ROLE);

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
    } catch (error) {
        logger.error(`Failed to ghost ping in #${randomChannel.name}: ${error.message}`);
    }
  },
  aprilfoolsMode: async function (guild) {
    // initialize april fools mode
    this.init(guild);

    // Phantom channels, 14 minute interval
    setInterval(() => {
      this.phantomChannels(guild);
    }, 14 * 60 * 1000); 

    // Profile swap, 30 minute interval
    setInterval(() => {
      this.profileSwap(guild);
    }, 30 * 60 * 1000); 

    // Hide channels, 10 minute interval
    setInterval(() => {
      this.hideChannels(guild);
    }, 10 * 60 * 1000);
  }
};

