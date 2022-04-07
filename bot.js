const { CommandoClient } = require('discord.js-commando');
const { Structures } = require('discord.js');
const path = require('path');
const { prefix, 
  messageTimer, 
  defaultRole, 
  word_filter, 
  idleTime, 
  version, 
  dev, 
  enable_word_filter, 
  corona_mode,
  cringemode
 } = require('./config.json');
const { token } = require('./keys.json');
const CatLoggr = require('cat-loggr');
const logger = new CatLoggr().setLevel(process.env.COMMANDS_DEBUG === 'true' ? 'debug' : 'info');
const express = require('express');
const app = express();
const port = 3001;

logger.info('Meme Cultist, a bot by Basbo Bibbins.');

app.get("/", (req, res)=> {
	res.send('Hello World!')
})

app.get("/system/reboot", (req, res)=> {
	process.exit(1);
})

app.listen(port, () => {
  logger.info(`Web server is online at http://localhost:${port}`);
})

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

client.on('debug', (message) => logger.log(message));
client.on('warn', (message) => logger.warn(message));
client.on('error', (error, message) => {
  logger.error(error);
  process.exit(1);
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
  logger.info('Loading compree!');
  client.user.setActivity('your music! '+prefix+'help', 'PLAYING');
});

client.on('guildMemberAdd', async member => {
  var role = member.guild.roles.cache.find(r => r.name === defaultRole);
  if (!role) return;
  member.roles.add(role);
  const channel = member.guild.channels.cache.find(c => c.name === 'welcome');
  if (!channel) return;
  channel.send(`**Welcome to the Meme Cult ${member} Now get out of my discord fucking normie.**`)
});

client.on('message', message => {

  if (!message.author.bot && message.content.startsWith(prefix)) {
    logger.info(`${message.author.username}#${message.author.discriminator} (${message.author.id}) ran command ${message.content.substr(0,message.content.indexOf(' '))}`);
  }

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

  if (cringemode) {
    if (message.author.id == 168935894978527232 ||  message.author.id == 746508305240817794) { //|| message.author.id == 186560785319723008 || message.author.id == 624682904127012864
      var rng = Math.floor(Math.random() * 5) // one in 10 chance
      if (rng == 4) {
        return message.channel.send("This is a reminder that "+`${message.author}`+" is cringe!");
      }
    }
  }
})

client.login(token);
