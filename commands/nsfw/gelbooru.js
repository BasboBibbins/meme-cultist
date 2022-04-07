const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const booru = require('booru');
const { version } = require('../../package.json');

module.exports = class GelCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'hentai',
      aliases: ['gelbooru', 'echii'],
      memberName: 'hentai',
      group: 'nsfw',
      nsfw: true,
      throttling: {
        usages: 1,
        duration: 5
      },
      description: 'Get an image from GelBooru.',
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
  var gelbooru = tags.split(' ');
  try {
    booru.search('gb', gelbooru, {limit: 1, random: true})
      .then(images => {
        for (let image of images) {
          const embed = new MessageEmbed()
            .setColor('#006FFA')
            .setURL(image.file_url)
            .setImage(image.file_url)
            .setAuthor('Gelbooru', 'https://i.imgur.com/1UbuKzP.png', image.file_url)
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
