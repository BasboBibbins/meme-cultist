const { Command } = require('@sapphire/framework');
const { MessageEmbed } = require('discord.js');
const booru = require('booru');
const { version } = require('../../package.json');

module.exports = class SafeCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'safebooru',
      aliases: ['sb', 'safe'],
      memberName: 'sb',
      group: 'fun',
      description: 'Get an image from SafeBooru.',
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'tags',
          prompt: 'Choose the tags you want to search on Safebooru.',
          type: 'string',
          default: '1girl',
          validate: tags => tags.length > 0 && tags.length < 200
        }
      ]
    });
}
async messageRun(msg, {tags}) {
  var sb = tags.split(' ');
  try {
    booru.search('sb', sb, {limit: 1, random: true})
      .then(images => {
        for (let image of images) {
          const embed = new MessageEmbed()
            .setColor('#006FFA')
            .setURL(image.file_url)
            .setImage(image.file_url)
            .setAuthor('Safebooru', 'https://i.imgur.com/wtDgsIS.png', image.file_url)
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