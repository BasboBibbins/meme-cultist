const { Command } = require('discord.js-commando');

module.exports = class SlotsCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'slots',
      aliases: ['sl'],
      memberName: 'slots',
      group: 'fun',
      description: "Play the slots, and you may win big!"
    });
  }
  run(message) {
    message.channel.send('**Coming soon:tm:**');
  }
};
