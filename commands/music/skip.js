const { Command } = require('discord.js-commando');

module.exports = class SkipCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'skip',
      aliases: ['skipsong', 'nextsong'],
      memberName: 'skip',
      group: 'music',
      description: 'Skip the song that is playing.',
      guildOnly: true
    });
  }

  run(message) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('You gotta be in a channel to skip bruh.');

    if (
      typeof message.guild.musicData.songDispatcher == 'undefined' || message.guild.musicData.songDispatcher == null
    )  {
      return message.reply('How are you supposed to skip a song if nothing is playing? :thinking:')
    }
    message.guild.musicData.songDispatcher.end();
  }
};
