const { Command } = require('discord.js-commando');
const quack = '.assets/sounds/quack.mp3';

module.exports = class soundQuack extends Command {
  constructor(client) {
    super(client, {
      name: 'quack',
      aliases: ['duck'],
      group: 'fun',
      memberName: 'quack',
      guildOnly: true,
      description: 'Makes the bot emit a quack.',
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
      message.react('🦆');
      voiceChannel.join()
        .then(connection => {
          const dispatcher = connection
            .play(quack)
            .on('finish', () => {
              message.guild.ttsData.isTTSRunning = false;
              return message.guild.me.voice.channel.leave();
            })
            .on('error', e => {
              message.say('Cannot speak :(');
              console.error(e);
              return message.guild.me.voice.channel.leave();
            });
        })
        .catch(e => {
          console.log(e);
          return message.guild.me.voice.channel.leave();
        });
    }
  }
};
