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
    }
};