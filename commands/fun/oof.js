const { Command } = require('discord.js-commando');
const { autoleave } = require('../../config.json');
const oof = "assets/sounds/oof.mp3";

module.exports = class soundOOF extends Command {
  constructor(client) {
    super(client, {
      name: 'oof',
      aliases: ['roblox'],
      group: 'fun',
      memberName: 'oof',
      guildOnly: true,
      description: 'Makes the bot emit a "oof" sound from ROBLOX.',
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

    if (message.guild.musicData.isPlaying == true)
      return message.channel.send('A song is running. Try again when the bot is not playing anything.');

    if (message.guild.ttsData.isTTSRunning == false) {
      message.guild.ttsData.isTTSRunning = true;
      message.react(':oof:362810358689169408');
      voiceChannel.join()
        .then(connection => {
          const dispatcher = connection
            .play(oof)
            .on('end', () => {
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
