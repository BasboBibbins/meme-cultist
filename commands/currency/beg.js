const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { addNewDBUser } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const logger = require("../../utils/logger");

module.exports = { 
    data: new SlashCommandBuilder()
        .setName("beg")
        .setDescription(`Beg for ${CURRENCY_NAME}.`),
    async execute(interaction) {
        const user = interaction.user;
        const dbUser = await db.get(interaction.user.id);
        const stats = `${user.id}.stats.begs`;
        if (!dbUser) {
            logger.warn(`No database entry for user ${interaction.user.username} (${interaction.user.id}), creating one...`)
            await addNewDBUser(interaction.user.id);
        }
        const amount = Math.floor(Math.random() * 100) + 1;
        const chance = Math.floor(Math.random() * 100) + 1;

        const fail_prompt = [
            `Try again later.`,
            `You're not going to get anything from me.`,
            `I don't have any ${CURRENCY_NAME}!`,
            `I'm not giving you any ${CURRENCY_NAME}!`,
            `Get a job!`,
            `I'm not your personal ATM!`,
            `Yeah, I'm thinking it's over for you.`,
            `S T F U`,
            `shit yourself`,
            `you don't have the right, O you don't have the right\ntherefore you don't have the right, O you don't have the right`,
            `You're pathetic.`,
            `You're just gonna lose it all in the casino anyway.`,
            `You're not getting any ${CURRENCY_NAME} from me.`,
            `i saw ${user.displayName} begging for ${CURRENCY_NAME} on discord, what a loser`,
            `really? you're begging for ${CURRENCY_NAME}?`,
            `you might as well give up`,
            `how about you get a job instead?`,
            `stop begging for ${CURRENCY_NAME} and get a job`,
            `maybe if you weren't so lazy you'd have ${CURRENCY_NAME} already`,
            `bro, you're not getting any ${CURRENCY_NAME} from me`,
            `if you're gonna beg for ${CURRENCY_NAME} at least do it in a more convincing way`,
            `if you stop begging for ${CURRENCY_NAME}, maybe i'll give you some later`,
            `shut the FREAK up dude`,
            `begging for ${CURRENCY_NAME} in ${interaction.guild.name}? good luck with that`,
            `you'll get no ${CURRENCY_NAME} from me`,
            `dude stop let me go`,
            `nerd emoji this man`,
            `begging for ${CURRENCY_NAME} in ${new Date().getFullYear()}? what a loser`,
            `try again on a different day`,
            `come back when you're not so pathetic`,
            `yea i'll give you ${CURRENCY_NAME}, come back on ${Math.floor(Math.random() * 12) + 1}/${Math.floor(Math.random() * 31) + 1}/${new Date().getFullYear()+Math.floor(Math.random() * 10) + 1}`,
            `you're not getting any ${CURRENCY_NAME} from me today`,
            `you'll get ${CURRENCY_NAME} from me when you decide to grow up`,
            `don't make me get a janny to ban you`,
            `final warning, stop begging for ${CURRENCY_NAME} or i WILL call a janny`,
            `${user.displayName} does it for free folks`,
        ]

        const embed = new EmbedBuilder()
            .setAuthor({name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
            .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
            .setTimestamp();

        if (dbUser.balance > 0 || dbUser.bank > 0) {
            embed.setColor("#ff0000");
            embed.setDescription(`You already have ${CURRENCY_NAME}${dbUser.balance < 0 && dbUser.bank > 0 ? ` in your bank`:``}!`);
            return await interaction.reply({embeds: [embed], ephemeral: true});
        }
            
        if (chance > 75) {
            embed.setColor("#00ff00");
            embed.setDescription(`Fine, here's **${amount}** ${CURRENCY_NAME}. Now stop annoying me.`);
            await db.add(`${user.id}.balance`, amount);
            await logger.info(`Added ${amount} ${CURRENCY_NAME} to ${interaction.user.username} (${interaction.user.id})'s wallet.`);
            await db.add(`${stats}.wins`, 1);
            await interaction.reply({embeds: [embed]});
        } else {
            embed.setColor("#ff0000");
            embed.setDescription(fail_prompt[Math.floor(Math.random() * fail_prompt.length)]);
            await db.add(`${stats}.losses`, 1);
            await interaction.reply({embeds: [embed]});
        }
        
    }
};
