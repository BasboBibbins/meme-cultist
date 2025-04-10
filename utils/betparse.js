const { QuickDB } = require("quick.db");

const db = new QuickDB({ filePath: `./db/users.sqlite` });

module.exports = {
    parseBet: async function (bet, id) {
        const dbUser = await db.get(id);
        const balance = dbUser.balance;

        switch (true) {
            case bet === "all" || bet === "max" || bet === "maxbet":
                return balance;

            case bet === "half":
                return Math.round(balance / 2);

            case bet === "quarter":
                return Math.round(balance / 4);

            case bet === "eighth":
                return Math.round(balance / 8);

            case bet.includes("/"):
                const betSplitDiv = bet.split("/");
                return Math.floor(betSplitDiv[0] / betSplitDiv[1]);

            case bet.includes("*"):
                const betSplitMul = bet.split("*");
                return Math.floor(betSplitMul[0] * betSplitMul[1]);

            case bet.includes("+"):
                const betSplitAdd = bet.split("+");
                return Math.floor(betSplitAdd[0] + betSplitAdd[1]);

            case bet.includes("-"):
                const betSplitSub = bet.split("-");
                return Math.floor(betSplitSub[0] - betSplitSub[1]);

            case bet.includes("%"):
                const betSplitPerc = bet.split("%");
                return Math.floor(betSplitPerc[0] * (betSplitPerc[1] / 100));

            case bet.includes("^"):
                const betSplitPow = bet.split("^");
                return Math.pow(betSplitPow[0], betSplitPow[1]);

            default:
                return Number(bet);
        }
    }
}