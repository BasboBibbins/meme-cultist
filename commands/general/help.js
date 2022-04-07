const { stripIndents, oneLine } = require('common-tags');
const { Command } = require('discord.js-commando');
const { MessageEmbed } = require('discord.js');
const { version } = require('../../package.json')

module.exports = class HelpCommand extends Command {
	constructor(client) {
		super(client, {
			name: 'help',
			group: 'general',
			memberName: 'help',
			aliases: ['commands'],
			description: 'Displays a list of available commands.',
			examples: ['help', 'help prefix'],
			args: [
				{
					key: 'command',
					prompt: 'Which command would you like to view the help for?',
					type: 'string',
					default: ''
				}
			]
		});
	}
  async run(msg, args) {
    const groups = this.client.registry.groups;
    const commands = this.client.registry.findCommands(args.command, false, msg);
    const showAll = args.command && args.command.toLowerCase() === 'all';
    if (args.command && !showAll) {
      if (commands.length === 1) {
				let body = `
					__${commands[0].name}__
					${commands[0].description}${commands[0].guildOnly ? ' *(Usable only in servers)*' : ''}${commands[0].nsfw ? ' *(Not Safe For Work!)*' : ''}\n
					**Format:** ${msg.anyUsage(`${commands[0].name}${commands[0].format ? ` ${commands[0].format}` : ''}`)}`;
					if(commands[0].aliases.length > 0) body += `\n**Aliases:** ${commands[0].aliases.join(', ')}`;
					body += `\n${oneLine`
						**Group:** ${commands[0].group.name}
						(\`${commands[0].groupID}:${commands[0].memberName}\`)
					`}`;
					if(commands[0].details) body += `\n**Details:** ${commands[0].details}`;
					if(commands[0].examples) body += `\n**Examples:**\n${commands[0].examples.join('\n')}`;
        const embed = new MessageEmbed()
          .setColor('#7289DA')
          .addField(`**Command Menu**`, body)
          .setFooter(`Meme Cultist | Ver. ${version}`, 'https://i.imgur.com/fbZ9H1I.jpg')
					const messages = [];
					try {
						messages.push(await msg.direct({ embed }));
						if (msg.channel.type !== 'dm') messages.push(await msg.reply('Sent ;)'));
					} catch(err) {
						messages.push(await msg.reply('Unable to send you the help DM. You probably have DMs disabled dummy.'));
					}
					return messages;
      } else if (commands.length > 15) {
        return msg.reply('multiple commands found, please be more specific.');
      } else if (commands.length > 1) {
        return msg.reply(disambiguation(commands, 'commands'));
      } else {
        return msg.reply(
					`Unable to identify command. Use ${msg.usage(
						null, msg.channel.type === 'dm' ? null : undefined, msg.channel.type === 'dm' ? null : undefined
					)} to view the list of all commands.`
				);
      }
    } else {
      const messages = [];
      const body = `${groups.filter(grp => grp.commands.some(cmd => !cmd.hidden && (showAll || cmd.isUsable(msg))))
        .map(grp => stripIndents`
          \n__${grp.name}__
          ${grp.commands.filter(cmd => !cmd.hidden && (showAll || cmd.isUsable(msg)))
            .map(cmd => `**${cmd.name}**`).join('\n')
          }
        `).join('\n\n')
      }`;
      const embed = new MessageEmbed()
        .setThumbnail('https://i.imgur.com/fbZ9H1I.jpg')
        .setColor('#7289DA')
        .setTitle('**Meme Cultist**')
        .addField('-=-=-=-=-=-=-=-', '**A bot by '+this.client.owners+'**\n[GitHub](https://github.com/BasboBibbins/meme-cultist) **|** [Trello](https://trello.com/b/TeAjOwjm/meme-cultist-discord-bot)')
        .addField('-=-=-=-=-=-=-=-', `\nTo run a command in ${msg.guild ? msg.guild.name : 'any server'},\nuse ${Command.usage('command', msg.guild ? msg.guild.commandPrefix : null, this.client.user)}\nFor example, ${Command.usage('normies', msg.guild ? msg.guild.commandPrefix : null, this.client.user)}.`)
        .addField('List of Commands:', body)
        .setFooter(`Ver. ${version} | ©2018-2021 Basbo#9817`, 'https://i.imgur.com/fbZ9H1I.jpg')
      try {
        messages.push(await msg.direct({ embed }));
        if (msg.channel.type !== 'dm') messages.push(await msg.reply('Sent ;)'));
      } catch(err) {
        messages.push(await msg.reply('Unable to send you the help DM. You probably have DMs disabled dummy.'));
      }
      return messages;
    }
  }
};
