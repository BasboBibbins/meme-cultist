const { QuickDB } = require('quick.db');
const db = new QuickDB({ filePath: './db/users.sqlite' });
const logger = require('./logger');

module.exports = {
    interest: async function () {
        const users = await db.all();
        for (const user of users) {
            if (user.value.bank > 0) {
                const interest = Math.round(user.value.bank / 100);
                await db.add(`${user.id}.bank`, interest);
                logger.info(`Interest added to ${user.value.name}'s account: ${interest}`);
            }
        }
    },
    parseAmount: async function (amount, id, subcommand) {
        const dbUser = await db.get(id);
        const balance = subcommand == `withdraw` ? dbUser.bank : dbUser.balance;

        if (amount == "all" || amount == "max" || amount == "maxamount") {
            return balance;
        }
        if (amount == "half") {
            return Math.round(balance / 2);
        }
        if (amount == "quarter") {
            return Math.round(balance / 4);
        }
        if (amount == "eighth") {
            return Math.round(balance / 8);
        }
        if (amount.includes("/")) {
            const betSplit = amount.split("/");
            return betSplit[0] / betSplit[1];
        }
        if (amount.includes("*")) {
            const betSplit = amount.split("*");
            return betSplit[0] * betSplit[1];
        }
        if (amount.includes("+")) {
            const betSplit = amount.split("+");
            return betSplit[0] + betSplit[1];
        }
        if (amount.includes("-")) {
            const betSplit = amount.split("-");
            return betSplit[0] - betSplit[1];
        }
        if (amount.includes("%")) {
            const betSplit = amount.split("%");
            return betSplit[0] * betSplit[1] / 100;
        }
        if (amount.includes("^")) {
            const betSplit = amount.split("^");
            return Math.pow(betSplit[0], betSplit[1]);
        }
        return Number(amount);
    },
    deposit: async function (id, amount) {
        await db.sub(`${id}.balance`, amount);
        await db.add(`${id}.bank`, amount);
    },
    withdraw: async function (id, amount) {
        await db.sub(`${id}.bank`, amount);
        await db.add(`${id}.balance`, amount);
    }
};