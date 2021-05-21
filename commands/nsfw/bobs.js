const { Command } = require('discord.js-commando');

module.exports = class BoobyCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'bobs',
      aliases: ['boobies', 'yonkers'],
      memberName: 'bobs',
      group: 'nsfw',
      nsfw: true,
      description: 'Shows you the nices pair of melons you will ever see.'
    });
  }
  run(msg) {
    msg.reply(':melon::melon:  :eyes:');
  }
}
