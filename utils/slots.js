const { EmbedBuilder } = require('discord.js');
const { QuickDB } = require("quick.db");
const db = new QuickDB({ filePath: `./db/users.sqlite` });
const { CURRENCY_NAME } = require('../config.json');
const { randomHexColor } = require('./randomcolor');
const wait = require('node:timers/promises').setTimeout;
const logger = require('../utils/logger');

const slotsDefaultEmoji = '<a:slots:1250275896007589962>';
const slotsEmoji = [
  { emoji: ':apple:', multiplier: 5, name: 'apples' },
  { emoji: ':tangerine:', multiplier: 10, name: 'oranges' },
  { emoji: ':lemon:', multiplier: 20, name: 'lemons' },
  { emoji: ':grapes:', multiplier: 30, name: 'grapes' },
  { emoji: ':cherries:', multiplier: 50, name: 'cherries' },
  { emoji: ':bell:', multiplier: 100, name: 'bell' },
  { emoji: '<:bar:1250276984576020530>', multiplier: 200, name: 'bars' },
  { emoji: '<:luckyseven:1250277002737619064>', multiplier: 500, name: 'sevens' },
];

async function rng(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generatePaytable(interaction) {
  const paytable = new EmbedBuilder()
    .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
    .setColor(randomHexColor())
    .setTitle('Slots Paytable')
    .setFooter({ text: `Meme Cultist | Version ${require('../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();
  let paytableEmoji = '', paytableMultiplier = '';
  let slotEmojiReverse = slotsEmoji.reverse();
  for (const slot of slotEmojiReverse) {
    paytableEmoji += `${slot.emoji} ${slot.emoji} ${slot.emoji}\n`;
    paytableMultiplier += `${slot.multiplier}x \n`;
  }
  paytableEmoji += `:cherries: :cherries:\n:cherries:\n`;
  paytableMultiplier += `2x\n1x\n`;

  paytable.addFields(
    { name: 'Emoji', value: paytableEmoji, inline: true },
    { name: 'Multiplier', value: paytableMultiplier, inline: true }
  );
  await interaction.reply({ embeds: [paytable] });
}

async function playSlots(interaction, bet, user, freePlaySpin = 0) {
  const freePlay = bet === 0;
  const actualBet = freePlay ? 100 : bet;
  const freeSpinsLeft = freePlay ? 4 - freePlaySpin : 0;

  logger.debug(`Initializing slots with ${actualBet} ${CURRENCY_NAME} ${freePlay ? `(FREE PLAY ${freeSpinsLeft+1}/5) ` : ''}for ${user.displayName}`);

  const slots = new EmbedBuilder()
    .setAuthor({ name: `${user.displayName} | Slots`, iconURL: user.displayAvatarURL({ dynamic: true }) })
    .setColor(randomHexColor())
    .setTitle('Good luck!')
    .setDescription(`${slotsDefaultEmoji} ${slotsDefaultEmoji} ${slotsDefaultEmoji}`)
    .setFooter({ text: `Bet: ${actualBet} ${CURRENCY_NAME} ${freePlay ? `(FREE SPIN ${freePlaySpin+1}/5)` : ''} | Meme Cultist | Version ${require('../package.json').version}`, iconURL: interaction.client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  if (freePlaySpin === 0) {
    await interaction.reply({ embeds: [slots] });
  } else {
    await interaction.editReply({ embeds: [slots] });
  }

  const slot1 = await rng(0, slotsEmoji.length - 1);
  const slot2 = await rng(0, slotsEmoji.length - 1);
  const slot3 = await rng(0, slotsEmoji.length - 1);

  const slotResults = [slot1, slot2, slot3];
  logger.debug(`Slot results: ${slotsEmoji[slot1].name} | ${slotsEmoji[slot2].name} | ${slotsEmoji[slot3].name}`);

  await wait(1000);
  slots.setDescription(`${slotsEmoji[slotResults[0]].emoji} ${slotsDefaultEmoji} ${slotsDefaultEmoji}`);
  await interaction.editReply({ embeds: [slots] });

  await wait(1000);
  slots.setDescription(`${slotsEmoji[slotResults[0]].emoji} ${slotsEmoji[slotResults[1]].emoji} ${slotsDefaultEmoji}`);
  await interaction.editReply({ embeds: [slots] });

  await wait(1000);
  slots.setDescription(`${slotsEmoji[slotResults[0]].emoji} ${slotsEmoji[slotResults[1]].emoji} ${slotsEmoji[slotResults[2]].emoji}`);
  await interaction.editReply({ embeds: [slots] });

  let winnings = actualBet;
  let desc = `${slotsEmoji[slotResults[0]].emoji} ${slotsEmoji[slotResults[1]].emoji} ${slotsEmoji[slotResults[2]].emoji}`;
  if (slotResults[0] === slotResults[1] && slotResults[1] === slotResults[2]) {
    winnings = winnings + (actualBet * slotsEmoji[slotResults[0]].multiplier);
    logger.debug(`Player won ${winnings} ${CURRENCY_NAME} with 3 ${slotsEmoji[slotResults[0]].name}`);
    slots.setColor(0x00FF00);
    slots.setTimestamp();
    if (slotResults[0] === 7 && slotResults[1] === 7 && slotResults[2] === 7) {
      slots.setTitle(`JACKPOT!!!${freePlay ? ' (ON A FREE SPIN?!?!)' : ''}`);
      slots.setDescription(`${desc}\n\nYou won **${winnings}** ${CURRENCY_NAME}! \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.${freePlay ? `\n\nFree spins left: ${freeSpinsLeft}` : ''}`);
      await db.add(`${user.id}.balance`, winnings);
      await db.add(`${user.id}.stats.slots.wins`, 1);
      await db.add(`${user.id}.stats.slots.jackpots`, 1);
      await interaction.editReply({ embeds: [slots] });
      await interaction.followUp({ content: `@everyone **${user.displayName}** just won the jackpot! Congratulations!`, allowedMentions: { parse: ['everyone'] } });
    } else {
      await db.add(`${user.id}.balance`, winnings);
      await db.add(`${user.id}.stats.slots.wins`, 1);
      slots.setTitle(`You won!${freePlay ? ' (Free spin)' : ''}`);
      slots.setDescription(`${desc}\n\nYou won **${winnings}** ${CURRENCY_NAME}! \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.${freePlay ? `\n\nFree spins left: ${freeSpinsLeft}` : ''}`);
      await interaction.editReply({ embeds: [slots] });
    }
  } else if (slotResults.includes(4)) {
    const cherryCount = slotResults.filter(x => x === 4).length;
    winnings = winnings * (cherryCount);
    logger.debug(`Player won ${winnings} ${CURRENCY_NAME} with ${cherryCount} cherr${cherryCount > 1 ? 'ies' : 'y'}`);
    await db.add(`${user.id}.balance`, winnings);
    await db.add(`${user.id}.stats.slots.wins`, 1);
    if (await db.get(`${user.id}.stats.slots.biggestWin`) < winnings) {
      await db.set(`${user.id}.stats.slots.biggestWin`, winnings);
    }
    slots.setColor(0x00FF00)
      .setTimestamp()
      .setTitle(`You won!${freePlay ? ' (Free spin)' : ''}`)
      .setDescription(`${desc}\n\nYou won **${winnings}** ${CURRENCY_NAME}! \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.${freePlay ? `\n\nFree spins left: ${freeSpinsLeft}` : ''}`);
    await interaction.editReply({ embeds: [slots] });
  } else {
    if (freePlay) {
      slots.setColor(0xFF0000)
        .setTitle(`You lost! (Free spin)`)
        .setTimestamp()
        .setDescription(`${desc}\n\nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}.${freePlay ? `\n\nFree spins left: ${freeSpinsLeft}` : ''}`);
      await interaction.editReply({ embeds: [slots] });
    } else {
      logger.debug(`Player lost ${actualBet} ${CURRENCY_NAME}`);
      await db.add(`${user.id}.stats.slots.losses`, 1);
      if (await db.get(`${user.id}.stats.slots.biggestLoss`) < actualBet) {
        await db.set(`${user.id}.stats.slots.biggestLoss`, actualBet);
      }
      slots.setColor(0xFF0000)
        .setTitle('You lost!')
        .setTimestamp()
        .setDescription(`${desc}\n\nYou lost **${winnings}** ${CURRENCY_NAME}. \nYour new balance is **${await db.get(`${user.id}.balance`)}** ${CURRENCY_NAME}. ${await db.get(`${user.id}.balance`) <= 0 ? `You are now broke!` : ''}`);
      await interaction.editReply({ embeds: [slots] });
    }
  }

  if (freePlay && freePlaySpin < 4) {
    await wait(3000); // delay before next free spin
    await playSlots(interaction, bet, user, freePlaySpin + 1);
  }
}

module.exports = {
  generatePaytable,
  playSlots,
};