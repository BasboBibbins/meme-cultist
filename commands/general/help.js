const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });

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
            .setColor(0x00AE86)
            .setFooter({ text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true}) })
            .setTimestamp();
        await interaction.reply({embeds: [embed], ephemeral: true});
    },
};