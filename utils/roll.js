const { createCanvas, loadImage } = require('canvas');
const { AttachmentBuilder } = require('discord.js');

module.exports = {
    roll: async (dice, number) => {
        if (number > 1) {
            let rolls = [];
            for (let i = 0; i < number; i++) {
                rolls.push(Math.floor(Math.random() * dice) + 1);
            }
            return rolls.join(', ');
        } else {
            return Math.floor(Math.random() * dice) + 1;
        }
    },
    drawDice: async (dice1, dice2) => {
        const canvas = createCanvas(540, 250);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const dice = [dice1, dice2];
                
        const diceImages = [];
        for (let i = 0; i < 2; i++) {
            diceImages.push(await loadImage(`./assets/imgs/roll/d${dice[i]}.png`));
        }

        ctx.drawImage(diceImages[0], 0, 0, 250, 250);
        ctx.drawImage(diceImages[1], 290, 0, 250, 250);

        const buffer = canvas.toBuffer('image/png');
        const file = new AttachmentBuilder(buffer)
                .setName('roll.png');
        return file;
    }

};