const { Command } = require('discord.js-commando');

module.exports = class eightBallCommand extends Command {
  constructor(client) {
    super(client, {
      name: '8ball',
      aliases: ['eightball'],
      memberName: '8ball',
      group: 'fun',
      description: "Get life advice from the bot.",
      throttling: {
        usages: 1,
        duration: 5
      },
      args: [
        {
          key: 'args',
          prompt: 'Type your text for the bot to analyze.',
          type: 'string',
          validate: args => args.length > 0
        }
      ]
    });
  }
  run(msg, {args}) {
    const eightball = [
      // affirmitive answers
      "It's certain bro.",
      "A definitive yes.",
      "Without a doubt. :ok_hand:",
      "A definite yes.",
      "You can rely on it.",
      "Yes.",
      "It'll probably happen.",
      "My sources say yes.",
      "The outlook is positive.",
      "All signs point to yes.",
      // negative answers
      "No.",
      "Don't count on it.",
      "My sources say no.",
      "I doubt it.",
      "The outlook is very bad.",
      "Your mother will die in her sleep tonight.",
      // non-committal answers
      "It's hazy... Try again later.",
      "Ask me later.",
      "It'd be better not to tell you now.",
      "I can't predict that at the moment. Sorry.",
      "You probably shouldn't rely on RNG for that."
    ]
    var rng = Math.floor(Math.random() * eightball.length)
    msg.channel.send('The magic 8 ball says: **' + eightball[rng] + '**')
  }
};
