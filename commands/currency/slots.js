const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: "./db/users.sqlite" });
const { addNewDBUser, setDBValue } = require("../../database");
const { CURRENCY_NAME } = require("../../config.json");
const { parseBet } = require('../../utils/betparse');
const wait = require('node:timers/promises').setTimeout;
const logger = require("../../utils/logger");
const { randomHexColor } = require('../../utils/randomcolor');

async function rng(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("slots")
        .setDescription(`Play a game of slots for ${CURRENCY_NAME}. Use \`/slots paytable\` to see the paytable.`)
        .addStringOption(option =>
            option.setName('bet')
                .setDescription(`The amount of ${CURRENCY_NAME} to bet.`)
                .setRequired(true)),
    async execute(interaction) {
        const user = interaction.user;
        const option = interaction.options.getString('bet');
        const slotsDefaultEmoji = '<a:slots:1072722137506390056>';
        const slotsEmoji = [
            { emoji: ':apple:', multiplier: 2 },
            { emoji: ':tangerine:', multiplier: 2 },
            { emoji: ':lemon:', multiplier: 2 },
            { emoji: ':grapes:', multiplier: 3 },
            { emoji: ':cherries:', multiplier: 5 },
            { emoji: ':bell:', multiplier: 10 },
            { emoji: '<:bar:413457783321657396>', multiplier: 15 },
            { emoji: '<:luckyseven:413457793019019264>', multiplier: 100 },
        ];

        if (option === 'paytable') {
            const paytable = new EmbedBuilder()
                .setAuthor({name: interaction.user.username+"#"+interaction.user.discriminator, iconURL: interaction.user.displayAvatarURL({dynamic: true})})
                .setColor(randomHexColor())
                .setTitle('Slots Paytable')
                .setFooter({text: `Meme Cultist | Version ${require('../../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({dynamic: true})})
                .setTimestamp();
            let paytableEmoji = '', paytableMultiplier = '';
            let slotEmojiReverse = slotsEmoji.reverse();
            for (const slot of slotEmojiReverse) {
                paytableEmoji += `${slot.emoji} ${slot.emoji} ${slot.emoji}\n`;
                paytableMultiplier += `${slot.multiplier}x \n`;
            }
            paytableEmoji+= `:cherries: :cherries:\n:cherries:\n`;
            paytableMultiplier+= `2x\n1x\n`;

            paytable.addFields(
                { name: 'Emoji', value: paytableEmoji, inline: true },
                { name: 'Multiplier', value: paytableMultiplier, inline: true }
            );
            await interaction.reply({ embeds: [paytable] });
            return;
        }

        const bet = Number(await parseBet(option, user.id));
        const dbUser = await db.get(user.id);
        if (!dbUser) {
            logger.warn(`No database entry for user ${user.username} (${user.id}), creating one...`)
            await addNewDBUser(user);
        }
        if (isNaN(bet)) {
            await interaction.reply({content: `You need to specify a valid bet amount!`, ephemeral: true});
            return;
        }
        if (bet % 1 != 0) {
            await interaction.reply({content: `You must bet a whole number of ${CURRENCY_NAME}`, ephemeral: true});
            return;
        }
        if (bet < 1) {
            await interaction.reply({content: `You must bet at least 1 ${CURRENCY_NAME}`, ephemeral: true});
            return;
        }
        if (bet > await db.get(`${user.id}.balance`)) {
            await interaction.reply({content: `You don't have enough ${CURRENCY_NAME} to bet that much!`, ephemeral: true});
            return;
        }

        await db.set(`${user.id}.balance`, await db.get(`${user.id}.balance`) - bet);

        const slots = new EmbedBuilder()
            .setAuthor({name: `${user.username+"#"+user.discriminator} | Slots`, iconURL: user.displayAvatarURL({dynamic: true})})            
            .setColor(randomHexColor())
            .setTitle('Good luck!')
            .setDescription(`${slotsDefaultEmoji} ${slotsDefaultEmoji} ${slotsDefaultEmoji}`)
            .setFooter({ text: `Bet: ${bet} ${CURRENCY_NAME}` })
            .setTimestamp();

        await interaction.reply({ embeds: [slots] });
        logger.log(`${user.username} (${user.id}) started a game of slots with a bet of ${bet} ${CURRENCY_NAME}.`)

        const slot1 = await rng(0, slotsEmoji.length - 1);
        const slot2 = await rng(0, slotsEmoji.length - 1);
        const slot3 = await rng(0, slotsEmoji.length - 1);

        const slotResults = [slot1, slot2, slot3];
        logger.debug(`${user.username} (${user.id}) rolled ${slotResults[0]}, ${slotResults[1]}, ${slotResults[2]}.`)
        
        await wait(1000);
        slots.setDescription(`${slotsEmoji[slotResults[0]].emoji} ${slotsDefaultEmoji} ${slotsDefaultEmoji}`);
        await interaction.editReply({ embeds: [slots] });
        
        await wait(1000);
        slots.setDescription(`${slotsEmoji[slotResults[0]].emoji} ${slotsEmoji[slotResults[1]].emoji} ${slotsDefaultEmoji}`);
        await interaction.editReply({ embeds: [slots] });
        
        await wait(1000);
        slots.setDescription(`${slotsEmoji[slotResults[0]].emoji} ${slotsEmoji[slotResults[1]].emoji} ${slotsEmoji[slotResults[2]].emoji}`);
        await interaction.editReply({ embeds: [slots] });

        let winnings = bet;
        let desc = `${slotsEmoji[slotResults[0]].emoji} ${slotsEmoji[slotResults[1]].emoji} ${slotsEmoji[slotResults[2]].emoji}`;
        if (slotResults[0] === slotResults[1] && slotResults[1] === slotResults[2]) {
            winnings = winnings + (bet * slotsEmoji[slotResults[0]].multiplier);
            slots.setColor(0x00FF00);
            slots.setTimestamp();
            if (slotResults[0] === 7 && slotResults[1] === 7 && slotResults[2] === 7) {
                slots.setTitle('JACKPOT!!!');
                slots.setDescription(`${desc}\n\nYou won **${winnings}** ${CURRENCY_NAME}! \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${user.id}.stats.slots.wins`, 1);
                await db.add(`${user.id}.stats.slots.jackpots`, 1);
                await interaction.editReply({ embeds: [slots] });
                await interaction.followUp({ content: `@everyone **${user.username}** just won the jackpot! Congratulations!`, allowedMentions: { parse: ['everyone'] }});
            } else {
                await db.add(`${user.id}.balance`, winnings);
                await db.add(`${user.id}.stats.slots.wins`, 1);
                slots.setTitle('You won!');
                slots.setDescription(`${desc}\n\nYou won **${winnings}** ${CURRENCY_NAME}! \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
                await interaction.editReply({ embeds: [slots] });
            }
        } else if (slotResults.includes(4)) {
            const cherryCount = slotResults.filter(x => x === 4).length;
            winnings = winnings * (cherryCount);
            await db.add(`${user.id}.balance`, winnings);
            await db.add(`${user.id}.stats.slots.wins`, 1);
            if (await db.get(`${user.id}.stats.slots.biggestWin`) < winnings) {
                await db.set(`${user.id}.stats.slots.biggestWin`, winnings);
            }
            slots.setColor(0x00FF00)
                .setTimestamp()
                .setTitle('You won!')
                .setDescription(`${desc}\n\nYou won **${winnings}** ${CURRENCY_NAME}! \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.`);
            await interaction.editReply({ embeds: [slots] });
        } else {
            await db.add(`${user.id}.stats.slots.losses`, 1);
            if (await db.get(`${user.id}.stats.slots.biggestLoss`) < bet) {
                await db.set(`${user.id}.stats.slots.biggestLoss`, bet);
            }
            slots.setColor(0xFF0000)
                .setTitle('You lost!')
                .setTimestamp()
                .setDescription(`${desc}\n\nYou lost **${winnings}** ${CURRENCY_NAME}. \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}. ${await db.get(`${user.id}.balance`) <= 0 ? `You are now broke!` : ''}`);
            await interaction.editReply({ embeds: [slots] });
        }
        logger.debug(`${user.username}#${user.discriminator} (${user.id}) bet ${bet} ${CURRENCY_NAME} and won ${(winnings - bet)} ${CURRENCY_NAME} on slots.`);
    },
};