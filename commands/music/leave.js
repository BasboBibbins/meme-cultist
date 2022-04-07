const { Command } = require('discord.js-commando');

module.exports = class LeaveCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'leave',
      aliases: ['end'],
      group: 'music',
      memberName: 'leave',
      guildOnly: true,
      description: 'Disconnects from the channel the bot is currently in.'
    });
  }

  run(message) {
    var voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('Join a channel and try again dumbo.');

    /*
    if (
      typeof message.guild.musicData.songDispatcher == 'undefined' ||
      message.guild.musicData.songDispatcher == null
    ) {
      return message.reply('How am I supposed to stop the song if no song is playing? :thinking:');
    }

    if (!message.guild.musicData.queue)
      return message.say('There are no songs in queue, therefore my job here is done.');
    */
    if (message.guild.musicData.songDispatcher != null) {
      message.guild.musicData.songDispatcher.end();
      message.guild.musicData.queue.length = 0;
    }
    message.guild.me.voice.channel.leave();
    return;
  }
};
