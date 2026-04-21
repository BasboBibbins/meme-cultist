const { QuickDB } = require("quick.db");
const logger = require('./logger');

const db = new QuickDB({ filePath: `./db/users.sqlite` });

module.exports = {
    parseBet: async function (bet, id) {
        const dbUser = await db.get(id);
        const balance = dbUser.balance;

        let expression = bet.toLowerCase().trim();

        // 1. Keyword substitution
        // We use regex with word boundaries to avoid replacing "half" inside another word
        expression = expression.replace(/\b(all|max|maxbet)\b/g, balance);
        expression = expression.replace(/\bhalf\b/g, `(${balance} / 2)`);
        expression = expression.replace(/\bquarter\b/g, `(${balance} / 4)`);
        expression = expression.replace(/\beighth\b/g, `(${balance} / 8)`);

        // 2. Percentage handling: "X%Y" becomes "X * (Y / 100)"
        // Match: [number/expression]%[number]
        const percRegex = /([0-9.() /*+-^]+)%([0-9.]+)/g;
        expression = expression.replace(percRegex, (_, base, perc) => `(${base} * (${perc} / 100))`);

        // 3. Safe Math Evaluation
        // only allowing numbers, basic operators, and parentheses.
        try {
            // Sanitize: only allow numbers, operators, dots, and parentheses
            if (/[^0-9. \/\*\+\-\(\)\^]/.test(expression)) {
                return NaN;
            }

            // Convert '^' to '**' for JS power operator
            const jsExpr = expression.replace(/\^/g, '**');

            // Use Function constructor for a slightly safer evaluation than eval()
            // but still restrictive to the sanitized string.
            const result = new Function(`return ${jsExpr}`)();

            return Math.floor(result);
        } catch (err) {
            logger.error(`[betparse] Failed to evaluate bet expression "${bet}": ${err.message}`);
            return NaN;
        }
    }
}