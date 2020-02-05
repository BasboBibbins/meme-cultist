const { Command } = require('discord.js-commando');
const { autoleave } = require('../../config.json');
const fbi = 'assets/sounds/fbi.mp3';

module.exports = class soundFBI extends Command {
  constructor(client) {
    super(client, {
      name: 'fbi',
      aliases: ['openup'],
      group: 'fun',
      memberName: 'fbi',
      guildOnly: true,
      description: "Oh yeah, that girl is definately a 8000 year old dragon...",
      guildOnly: true,
      clientPermissions: ['SPEAK', 'CONNECT'],
      throttling: {
        usages: 2,
        duration: 10
      }
    });
  }


  run(message) {
    var voiceChannel = message.member.voice.channel;

    if (!voiceChannel) return message.say('Join a channel and try again');

    if (message.guild.musicData.isPlaying === true)
      return message.channel.send('A song is running. Try again when the bot is not playing anything.');

    if (message.guild.ttsData.isTTSRunning == false) {
      message.guild.ttsData.isTTSRunning = true;
      message.react('🚨');
      voiceChannel.join()
        .then(connection => {
          const dispatcher = connection
            .play(fbi)
            .on('finish', () => {
              message.guild.ttsData.isTTSRunning = false;
              if (autoleave) {return voiceChannel.leave()};
            })
            .on('error', e => {
              message.say('Cannot speak :(');
              console.error(e);
              if (autoleave) {return voiceChannel.leave()};
            });
        })
        .catch(e => {
          console.log(e);
          if (autoleave) {return voiceChannel.leave()};
        });
    }
  }
};
