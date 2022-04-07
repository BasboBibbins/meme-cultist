const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const { version } = require('../../package.json');

module.exports = class QueueCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'queue',
      aliases: ['songlist', 'nextsongs'],
      group: 'music',
      memberName: 'queue',
      guildOnly: true,
      description: 'Display the currently queued songs.',
      throttling: {
        usages: 1,
        duration: 5
      }
    });
  }

  run(message) {
    if (message.guild.musicData.queue.length == 0)
      return message.say('There are no songs in queue!');
    const titleArray = [];
    message.guild.musicData.queue.map(obj => {
      titleArray.push(obj.title);
    });
    var queueEmbed = new MessageEmbed()
      .setColor('#FF0000')
      .setTitle('Music Queue')
      .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
    for (let i = 0; i < titleArray.length; i++) {
      queueEmbed.addField(`${i + 1}:`, `${titleArray[i]}`);
    }
    return message.say(queueEmbed);
  }
};
