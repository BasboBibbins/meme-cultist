const { Command } = require('discord.js-commando');

module.exports = class AyyCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'ayy',
      memberName: 'ayy',
      group: 'fun',
      description: 'lmao'
    });
  }
  run(message) {
    message.reply('lmao :alien:');
  }
};
