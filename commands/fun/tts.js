const { Command } = require('discord.js-commando');
const { autoleave } = require('../../config.json');

module.exports = class ttsCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'tts',
      aliases: ['text-to-speech'],
      group: 'fun',
      memberName: 'tts',
      guildOnly: true,
      description: 'Make the bot say something over voice via text-to-speech.',
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'args',
          prompt: 'Type what you want the bot to say.',
          type: 'string'
        }
      ]
    });
  }

  run(message, { args }) {
    var voiceChannel = message.member.voice.channel;

    if (!voiceChannel) return message.say('Join a channel and try again');

    if (message.guild.musicData.isPlaying === true)
      return message.channel.send('A song is running. Try again when the bot is not playing anything.');

    if (message.guild.ttsData.isTTSRunning == false) {
      message.guild.ttsData.isTTSRunning = true;
      voiceChannel.join()
        .then(connection => {
          const dispatcher = connection
            .play(
              'https://tts.cyzon.us/tts?text='+encodeURI(args)
            )
            .on('finish', () => {
              message.guild.ttsData.isTTSRunning = false;
              if (autoleave) {return message.guild.me.voice.channel.leave()};
            })
            .on('error', e => {
              message.say('Cannot speak :(');
              console.error(e);
              if (autoleave) {return message.guild.me.voice.channel.leave()};
            });
        })
        .catch(e => {
          console.log(e);
          if (autoleave) {return message.guild.me.voice.channel.leave()};
        });
    }
  }
};
