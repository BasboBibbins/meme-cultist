const { Command } = require('discord.js-commando');

module.exports = class ChooseCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'choose',
      aliases: ['decide'],
      memberName: 'choose',
      group: 'fun',
      description: "Let the bot make life-or-death decisions for you!",
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'args',
          prompt: 'Type your options for the bot.',
          type: 'string',
          validate: args => args.length > 0
        }
      ]
    });
  }
  run(msg, {args}) {
    var choices = args.split(' ')
    if (choices.length === 1)
      return msg.channel.send('I don\'t know... It\'s very hard to choose when there are _soooooooooo_ many options... :thinking:');
    var rng = Math.floor(Math.random() * choices.length)
    msg.channel.send('Personally, I prefer **' + choices[rng] + '**.')
  }
};
