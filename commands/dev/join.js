const { Command } = require('discord.js-commando');
const { dev } = require('../../config.json');
if (!dev) return;
module.exports = class joinCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'join',
      memberName: 'join',
      group: 'dev',
      ownerOnly: true,
      description: 'Throws the "guildMemberAdd" hook for testing purposes.'
    });
  }
  run(message) {
    this.client.emit('guildMemberAdd', message.member || message.guild.fetchMember(message.author));
  }
};
