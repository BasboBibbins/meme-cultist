const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const booru = require('booru')

module.exports = class GelCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'smuganimegirl',
      aliases: ['smug', ':smirk:'],
      memberName: 'smug',
      group: 'fun',
      description: 'Get an image of a smug-ass anime girl.'
    });
}
async run(msg) {
  try {
    booru.search('sb', ['1girl', 'smug', 'looking_at_viewer'], {limit: 1, random: true})
      .then(images => {
        for (let image of images) {
          const embed = new MessageEmbed()
            .setImage(image.file_url)
          msg.channel.send({ embed })
        }
      })
  } catch(e) {
      msg.reply('No image found with tag(s) ``"'+tags+'"``');
      console.log(e)
    }
  }
};
