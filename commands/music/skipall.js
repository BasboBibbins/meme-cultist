const { Command } = require('discord.js-commando');

module.exports = class SkipAllCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'skipall',
      aliases: ['clear'],
      memberName: 'skipall',
      group: 'music',
      description: 'Skip all songs in queue.',
      guildOnly: true,
      throttling: {
        usages: 1,
        duration: 5
      },
    });
  }

  run(message) {
    var voiceChannel = message.member.voice.channel;
    var authorid = message.author.id;
    var isClearing = false;
    if (!voiceChannel) return message.reply('Get in a channel first stupid.');

    if (
      typeof message.guild.musicData.songDispatcher == 'undefined' ||
      message.guild.musicData.songDispatcher == null
    ) {
      return message.reply('There is no song playing!');
    }
    if (!message.guild.musicData.queue)
      return message.say('The queue is already empty. My job here is done.');
    if (isClearing)
      return message.say('The clear menu is already open.');
    isClearing = true;
    message.channel.send('Are you sure you want the clear the queue? (This can\'t be undone!)')
    .then((message) => {
      message.react(':heccnah:412733834279387137');
      message.react(':heccyah:412733816503926785');
      var rYes = (reaction, user) => reaction.emoji.id === '412733816503926785' && user.id === authorid;
      var rNo = (reaction, user) => reaction.emoji.id === '412733834279387137' && user.id === authorid;

      var cYes = message.createReactionCollector(rYes);
      cYes.on('collect', (reaction, user) => {
        isClearing = false;
        message.delete();
        message.guild.musicData.songDispatcher.end();
        message.guild.musicData.queue.length = 0;
        message.channel.send('All of those crappy songs have been removed from the queue. Thank me later. :put_litter_in_its_place:');
      });

      var cNo = message.createReactionCollector(rNo);
      cNo.on('collect', (reaction, user) => {
        isClearing = false;
        message.delete();
        message.channel.send('Clear canceled.');
      })
    })
    return;
  }
};
