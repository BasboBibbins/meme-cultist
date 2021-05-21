const { Command } = require('discord.js-commando');

module.exports = class NormiesCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'normies',
      aliases: ['normie'],
      memberName: 'normies',
      group: 'fun',
      description: "Get off my discord!"
    });
  }
  run(message) {
    message.channel.send('**FUCKING NORMIES! GET THE FUCK OUT OF MY DISCORD!! _REEEEEEEEEEEEEEEEEEEEEEEEEEEE_**');
  }
};
