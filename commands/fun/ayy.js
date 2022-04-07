const { Command } = require('discord.js-commando');

module.exports = class AyyCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'ayy',
      memberName: 'ayy',
      group: 'fun',
      description: 'lmao',
      throttling: {
        usages: 1,
        duration: 5
      }
    });
  }
  run(message) {
    message.reply('lmao :alien:');
  }
};
