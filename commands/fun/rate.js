const { Command } = require('discord.js-commando');

module.exports = class RateCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'rate',
      aliases: ['score'],
      memberName: 'rate',
      group: 'fun',
      description: "What you said will be rated by the bot.",
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'args',
          prompt: 'Type what you want rated by the bot.',
          type: 'string',
          validate: args => args.length > 0
        }
      ]
    });
  }
  run(msg, {args}) {
    var rng = Math.floor(Math.random() * 10)
    msg.channel.send('I give **'+args+'** a **'+rng+'/10.**')
  }
};
