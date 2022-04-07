const { Command } = require('@sapphire/framework');

module.exports = class MagaCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'darkmaga',
      aliases: ['darkify', 'qpost'],
      memberName: 'darkmaga',
      group: 'fun',
      description: "CRVVTV DVRK MVGV TVXT",
      args: [
        {
          key: 'args',
          prompt: 'Type the text you want dark maga-fied.',
          type: 'string'
        }
      ]
    });
  }
  async messageRun(message, { args }) {
    var text = args;
    text = text.toUpperCase();
    text = text.replace(/[AEIU]/g, 'V');
    text = text.replace(/O/g, 'Q');
    message.channel.send(text);
  }
};