console.log('Meme Cultist, a bot by Basbo Bibbins.');

const { CommandoClient } = require('discord.js-commando');
const { Structures } = require('discord.js');
const path = require('path');
const { prefix, messageTimer, defaultRole, token, word_filter, idleTime, version, dev, enable_word_filter, corona_mode } = require('./config.json');

Structures.extend('Guild', Guild => {
  class MusicGuild extends Guild {
    constructor(client, data) {
      super(client, data);
      this.musicData = {
        queue: [],
        isPlaying: false,
        nowPlaying: null,
        songDispatcher: null,
        repeat: false
      };
      this.ttsData = {
        isTTSRunning: false,
        ttsQueue: []
      };
      this.genData = {
        idleTime: idleTime * 1000,
        verNum: version
      }
    }
  }
  return MusicGuild;
});

const client = new CommandoClient({
  commandPrefix: prefix,
  owner: '139152443991654401'
});

if (dev === true)  {
  client.registry.registerGroups([
    ['dev', 'Developer Commands']
  ])
}

client.registry
  .registerDefaultTypes()
  .registerTypesIn(path.join(__dirname, 'types'))
  .registerGroups([
    ['general', 'General Commands'],
    ['music', 'Music Commands'],
    ['fun', 'Fun Commands'],
    ['nsfw', 'NSFW Commands']
  ])
  //.registerDefaultGroups()
  //.registerDefaultCommands()
  .registerCommandsIn(path.join(__dirname, 'commands'));

client.once('ready', () => {
  console.log('Loading compree!');
  client.user.setActivity('your music! '+prefix+'help', 'PLAYING');
});

client.on('guildMemberAdd', async member => {
  const role = member.guild.roles.find(r => r.name === defaultRole);
  if (!role) return;
  member.roles.add(role).catch(console.error);
  const channel = member.guild.channels.find(c => c.name === 'welcome');
  if (!channel) return;
  channel.send(`**Welcome to the Meme Cult ${member} Now get out of my discord fucking normie.**`)
});

client.on('message', message => {

  if (corona_mode && !message.author.bot) {
    message.channel.send("-------------SOCIAL DISTANCE LINE-------------");
    message.channel.send("󠇰    󠇰    󠇰    󠇰    󠇰    󠇰");
    message.channel.send("󠇰    󠇰    󠇰    󠇰    󠇰    󠇰");
    message.channel.send("󠇰    󠇰    󠇰    󠇰    󠇰    󠇰");
    message.channel.send("-----------END SOCIAL DISTANCE LINE-----------󠇰");
  }

  const timer = (messageTimer * 1000);
  setTimeout(() => {
    if (message.author.bot) {
      if (messageTimer <= 0) return;
      message.delete()
    }
  }, timer)
  for (var i = 0; i < word_filter.length; i++) {
    word_filter[i] = word_filter[i].toUpperCase()
    msg = message.content.toUpperCase();
    if (enable_word_filter && msg.includes(word_filter[i])) {
      message.delete();
      return message.channel.send("***\n[MESSAGE REMOVED BY PEOPLE'S REPUBLIC OF CHINA]\n[被中華人民共和國刪除的消息]***");
    }
  }
})

client.login(token);
