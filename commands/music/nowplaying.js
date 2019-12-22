const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const { version } = require('../../package.json')

module.exports = class npCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'np',
      aliases: ['nowplaying'],
      group: 'music',
      memberName: 'np',
      guildOnly: true,
      description: 'Display the currently plaing song.'
    });
  }

  run(message) {
    if (message.guild.musicData.nowPlaying == null || !message.guild.musicData.isPlaying)
      return message.say('There is no song playing. Why not request your own?');
    var queueEmbed = new MessageEmbed()
      .setThumbnail(message.guild.musicData.nowPlaying.thumbnail)
      .setColor('#FF0000')
      .addField('Now Playing:', '<:youtube:417745828439130123> '+message.guild.musicData.nowPlaying.title)
      .addField('Duration:', message.guild.musicData.nowPlaying.duration)
      .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
    return message.say(queueEmbed);
  }
};
