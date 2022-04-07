const { Command } = require('discord.js-commando');
const CatLoggr = require('cat-loggr');
const logger = new CatLoggr().setLevel(process.env.COMMANDS_DEBUG === 'true' ? 'debug' : 'info');

module.exports = class RestartCommand extends Command {
  constructor(client) {
    super(client, {
      name: 'restart',
      aliases: ['reboot'],
      memberName: 'restart',
      group: 'general',
      description: "Restarts the bot after a couple seconds.",
      clientPermissions: ['MANAGE_GUILD'],
      throttling: {
        usages: 1,
        duration: 10
      }
    });
  }
  run(message) {
    var authorid = message.author.id
    message.channel.send(`Are you sure you want to restart the bot?`)
    .then((message) => {
        message.react(':heccyah:412733816503926785');
        message.react(':heccnah:412733834279387137');
        var rYes = (reaction, user) => reaction.emoji.id === '412733816503926785' && user.id === authorid;
        var rNo = (reaction, user) => reaction.emoji.id === '412733834279387137' && user.id === authorid;

        var cYes = message.createReactionCollector(rYes);
        cYes.on('collect', (reaction, user) => {
            message.delete();
            message.channel.send('Bot is restarting! Please give me at least 30 seconds after restart to be fully functional. See you soon! :wave:')
            logger.info('Bot is restarting...')
            setTimeout(f => {process.exit(1)}, 5000); //5sec delay
        });
  
        var cNo = message.createReactionCollector(rNo);
        cNo.on('collect', (reaction, user) => {
            message.delete();
        })
    })
  }
};
