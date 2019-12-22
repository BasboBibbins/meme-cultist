const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const urban = require("urban");
const { version } = require('../../package.json')

module.exports = class UrbanCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'urban',
      aliases: ['urbandictionary'],
      memberName: 'urban',
      group: 'fun',
      description: "Get an accurate definition from Urban Dictionary.",
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'args',
          prompt: 'Type what word/phrase you want to look up.',
          type: 'string',
          default: 'random'
        }
      ]
    });
  }
  run(msg, {args}) {
    var targetWord = args === 'random' ? urban.random() : urban(args);
    targetWord.first((json) => {
      if (json){
        var body = `**${json.word}:**\n${json.definition}\n`;
        if (json.example)
          body += `\n**Example:**\n ${json.example}`
        var embed = new MessageEmbed()
          .setColor('#EFFF00')
          .setAuthor('Urban Dictonary:', 'https://i.imgur.com/fbZ9H1I.jpg', 'https://www.urbandictionary.com/')
          .addField(`-=-=-=-=-=-=-=-=-=-=-=-`, `${body}`)
          .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
        msg.channel.send({ embed });
      } else {
        msg.channel.send('No matches found.')
      }
    })
  }
};
