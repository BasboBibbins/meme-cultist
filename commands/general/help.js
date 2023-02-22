const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { randomHexColor } = require('../../utils/randomcolor');
const { OWNER_ID } = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Get help on a command.")
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The command to get help on.')
                .setRequired(false)
                .setAutocomplete(true)),
    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const commands = interaction.client.slashcommands;
        const commandOptions = commands.map(command => ({ name: command.data.name, value: command.data.name }));
        const filtered = commandOptions.filter(commandOption => commandOption.name.toLowerCase().startsWith(focusedValue.toLowerCase()));
        await interaction.respond(
            filtered.map(commandOption => ({ name: commandOption.name, value: commandOption.value }))
        );
    },
    async execute(interaction) {
        const commandName = interaction.options.getString('command');
        if (!commandName) {
            const embed = new EmbedBuilder()
                .setAuthor({ name: `Meme Cultist Help`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
                .addFields(
                    { 
                        name: "General Information", 
                        value: `**${interaction.client.user.username}** is a bot created by <@${OWNER_ID}> mainly for the purpose of being a fun bot for the Meme Cult. It has a variety of features, including a currency system, a music player, and other fun commands.\n\nThe bot is still in development, so expect more features to be added in the future. If you have any suggestions, feel free to DM <@${OWNER_ID}>!`,
                        inline: false 
                    },
                    {
                        name: "Commands",
                        value: `The bot has a total of ${interaction.client.slashcommands.size} commands. Use \`/help [command]\` to get help on a specific command. For example, \`/help balance\` will give you help on the \`/balance\` command.`,
                        inline: false
                    },
                    {
                        name: "Links",
                        value: `[Invite Link](https://discord.com/api/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=8&scope=bot%20applications.commands)\n[Support Server](https://discord.gg/C3cMvwP)\n[GitHub Repository](https://github.com/BasboBibbins/meme-cultist)`,
                        inline: false
                    },
                    {
                        name: "Copyright",
                        value: `©️ 2023 BasboBibbins (<@${OWNER_ID}>).\nLicensed under the [MIT License](https://github.com/BasboBibbins/meme-cultist/blob/master/LICENSE) and the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode).`,
                        inline: false
                    }
                )
                .setColor(randomHexColor())
                .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) })
                .setTimestamp();
            let msg = await interaction.reply({embeds: [embed], ephemeral: true});
            return;
        }
        const command = interaction.client.slashcommands.get(commandName);
        if (!command) {
            await interaction.reply({content: `No command found with name \`${commandName}\``, ephemeral: true});
            return;
        }
        const embed = new EmbedBuilder()
            .setAuthor({ name: `/${command.data.name}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
            .setDescription(`${command.data.description}\n\n**Usage:** \`/${command.data.name} ${command.data.options.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(' ')}\`\n\n**__Options:__**`)
            .addFields(command.data.options.map(option => {
                return {
                    name: option.name,
                    value: option.description,
                    inline: true
                    }
                })
            )
            .setColor(randomHexColor())
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) })
            .setTimestamp();
        await interaction.reply({embeds: [embed], ephemeral: true});
    },
};