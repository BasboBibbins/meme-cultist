const { Command } = require('discord.js-commando');

module.exports = class PauseCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'pause',
      aliases: ['resume', 'continue', 'stop', 'unpause'],
      memberName: 'pause',
      group: 'music',
      description: 'Toggle pausing/unpausing the current playing song.',
      guildOnly: true
    });
  }

  run(message) {
    var voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('Join a channel and try again');

    if (
      typeof message.guild.musicData.songDispatcher == 'undefined' ||
      message.guild.musicData.songDispatcher == null
    ) {
      return message.say('There is no song playing right now!');
    }
    //console.log(message.guild.musicData.isPlaying);
    if (message.guild.musicData.isPlaying == true || message.guild.musicData.isPlaying == null) {
      message.say(':pause_button: ***Song pause***');
      message.guild.musicData.songDispatcher.pause();
      message.guild.musicData.isPlaying = false;
    } else {
      message.say(':arrow_forward: ***Song resumed***');
      message.guild.musicData.songDispatcher.resume();
      message.guild.musicData.isPlaying = true;
    }
  }
};
