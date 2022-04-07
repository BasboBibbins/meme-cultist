const { Command } = require('discord.js-commando');
const { autoleave } = require('../../config.json');
const fortnite = 'assets/sounds/fortnite.mp3';

module.exports = class soundFort extends Command {
  constructor(client) {
    super(client, {
      name: 'fortnite',
      aliases: ['defaultdance'],
      group: 'fun',
      memberName: 'fornite',
      guildOnly: true,
      description: "This command makes the bot default dance on those n00bs.",
      guildOnly: true,
      clientPermissions: ['SPEAK', 'CONNECT'],
      throttling: {
        usages: 1,
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
      voiceChannel.join()
        .then(connection => {
          const dispatcher = connection
            .play(fortnite)
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
