const { QuickDB } = require("quick.db");

const db = new QuickDB({ filePath: "./db/users.sqlite" });

module.exports = {
    parseBet: async function (bet, id) {
        const dbUser = await db.get(id);
        const balance = dbUser.balance;
        if (bet == "all" || bet == "max" || bet == "maxbet") {
            return balance;
        }
        if (bet == "half") {
            return Math.round(balance / 2);
        }
        if (bet == "quarter") {
            return Math.round(balance / 4);
        }
        if (bet == "eighth") {
            return Math.round(balance / 8);
        }
        if (bet.includes("/")) {
            const betSplit = bet.split("/");
            return betSplit[0] / betSplit[1];
        }
        if (bet.includes("*")) {
            const betSplit = bet.split("*");
            return betSplit[0] * betSplit[1];
        }
        if (bet.includes("+")) {
            const betSplit = bet.split("+");
            return betSplit[0] + betSplit[1];
        }
        if (bet.includes("-")) {
            const betSplit = bet.split("-");
            return betSplit[0] - betSplit[1];
        }
        if (bet.includes("%")) {
            const betSplit = bet.split("%");
            return betSplit[0] * betSplit[1] / 100;
        }
        if (bet.includes("^")) {
            const betSplit = bet.split("^");
            return Math.pow(betSplit[0], betSplit[1]);
        }
        return bet;
    }
}