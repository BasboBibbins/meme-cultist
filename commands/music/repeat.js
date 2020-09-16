const { Command } = require('discord.js-commando');

module.exports = class RepeatSongCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'repeat',
      memberName: 'repeat',
      group: 'music',
      alias: ['loop'], 
      description: 'Remove a specific song from queue',
      guildOnly: true
    });
  }
  run(message, { songNumber }) {
    var voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('Join a channel and try again');
    /*
    if (
      typeof message.guild.musicData.songDispatcher == 'undefined' ||
      message.guild.musicData.songDispatcher == null
    ) {
      return message.reply('There is no song playing right now!');
    }
    */
    if (message.guild.musicData.repeat == false) {
      message.guild.musicData.repeat = true;
      return message.say("Song will now repeat.");
    } else {
      message.guild.musicData.repeat = false;
      return message.say("Song will no longer repeat.");
    }
  }
};
