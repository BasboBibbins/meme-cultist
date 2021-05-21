const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const booru = require('booru');
const { version } = require('../../package.json');

module.exports = class loliCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'loli',
      aliases: ['lolibooru', 'lb'],
      memberName: 'loli',
      group: 'nsfw',
      nsfw: true,
      description: 'Get an image from LoliBooru.',
      args: [
        {
          key: 'tags',
          prompt: 'Choose the tags you want to search on LoliBooru.',
          type: 'string',
          default: 'nude',
          validate: tags => tags.length > 0 && tags.length < 200
        }
      ]
    });
}
async run(msg, {tags}) {
  var loli = tags.split(' ');
  try {
    booru.search('lb', loli, {limit: 1, random: true})
      .then(images => {
        for (let image of images) {
          const embed = new MessageEmbed()
            .setColor('#D6B1B1')
            .setURL(image.file_url)
            .setImage(image.file_url)
            .setAuthor('Lolibooru', 'https://i.imgur.com/fbZ9H1I.jpg', image.file_url)
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
