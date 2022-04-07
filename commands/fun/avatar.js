const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');

module.exports = class Avatar extends Command {
  constructor(client) {
    super(client, {
      name: 'avatar',
      aliases: ['pfp', 'icon'],
      memberName: 'avatar',
      group: 'fun',
      description: "Steal someone's profile picture!",
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'args',
          prompt: 'Mention or type the username that you want to use.',
          type: 'string',
          default: msg => msg.author
        }
      ]
    });
}
async run(msg, args) {
  try {
    var user;
    if (msg.mentions.users.first()) {
      user = msg.mentions.users.first();
    } else if (args[0]) {
      user = msg.guild.members.cache.get(args[0]).user;
    } else  {
      user = msg.author;
    }
    var attachment = user.displayAvatarURL({size: 4096, dynamic: true});

    if (user.id == 139167054400978944) return msg.channel.send("Please change your profile picture."); // banned users

    if (Buffer.byteLength(attachment) > 8e+6) return msg.reply('Resulting image was above 8 MB.');
    return msg.channel.send({ files: [{ attachment }] });
  } catch(e) {
      msg.reply('**An error occured:**\n```javascript\n'+e+'\n```');
      console.log(e)
    }
  }
};
