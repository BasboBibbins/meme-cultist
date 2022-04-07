const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const booru = require('booru');
const { version } = require('../../package.json');

module.exports = class GelCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'rule34',
      aliases: ['thirtyfour', 'r34'],
      memberName: 'r34',
      group: 'nsfw',
      nsfw: true,
      throttling: {
        usages: 1,
        duration: 5
      },
      description: 'Get an image from rule34.xxx.',
      args: [
        {
          key: 'tags',
          prompt: 'Choose the tags you want to search on GelBooru.',
          type: 'string',
          default: 'nude',
          validate: tags => tags.length > 0 && tags.length < 200
        }
      ]
    });
}
async run(msg, {tags}) {
  var r34 = tags.split(' ');
  try {
    booru.search('r34', r34, {limit: 1, random: true})
      .then(images => {
        for (let image of images) {
          const embed = new MessageEmbed()
            .setColor('#AAE5A3')
            .setURL(image.file_url)
            .setImage(image.file_url)
            .setAuthor('rule34.xxx', 'https://rule34.xxx/favicon.ico', image.file_url)
            .addField('Tags:', '``'+image.tags+'``')
            .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
          msg.channel.send(`**Image Found** ${image.file_url.endsWith('.webm') ? image.file_url : ''}${image.file_url.endsWith('.mp4') ? image.file_url : ''}`, { embed })
        }
      })
  } catch(e) {
      msg.reply('No image found with tag(s) ``"'+tags+'"``');
      console.log(e)
    }
  }
};
