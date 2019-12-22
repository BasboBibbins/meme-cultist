const { Command } = require('discord.js-commando');

module.exports = class NormiesCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'owo',
      aliases: ['owoify'],
      memberName: 'owo',
      group: 'fun',
      description: "owo-ifies your text.",
      args: [
        {
          key: 'args',
          prompt: 'Type the text you want owo-ified.',
          type: 'string'
        }
      ]
    });
  }
  run(message, { args }) {
    var text = args;
    text = text.replace(/[lr]/g, 'w');
    text = text.replace(/u/g, 'uw');
    message.channel.send(text);
  }
};
