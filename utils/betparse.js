const { db } = require('../database');
const logger = require('./logger');

/**
 * Safe recursive-descent math expression evaluator.
 * Supports: + - * / ^ () and numeric literals (including decimals).
 * Does NOT support variables, functions, or any other JavaScript features, making it safe against code injection.
 */
function safeMathEval(expr) {
    let pos = 0;

    function peek() { return expr[pos]; }
    function consume() { return expr[pos++]; }
    function skipSpaces() { while (pos < expr.length && expr[pos] === ' ') pos++; }

    function parseExpr() {
        let result = parseTerm();
        skipSpaces();
        while (pos < expr.length && (peek() === '+' || peek() === '-')) {
            const op = consume();
            const right = parseTerm();
            result = op === '+' ? result + right : result - right;
            skipSpaces();
        }
        return result;
    }

    function parseTerm() {
        let result = parsePower();
        skipSpaces();
        while (pos < expr.length && (peek() === '*' || peek() === '/')) {
            const op = consume();
            const right = parsePower();
            if (op === '/' && right === 0) throw new Error("Division by zero");
            result = op === '*' ? result * right : result / right;
            skipSpaces();
        }
        return result;
    }

    function parsePower() {
        let result = parseUnary();
        skipSpaces();
        if (pos < expr.length && peek() === '^') {
            consume();
            const right = parsePower(); // Right-associative: 2^3^2 = 2^(3^2)
            result = Math.pow(result, right);
            skipSpaces();
        }
        return result;
    }

    function parseUnary() {
        skipSpaces();
        if (peek() === '-') {
            consume();
            return -parseAtom();
        }
        if (peek() === '+') {
            consume();
            return parseAtom();
        }
        return parseAtom();
    }

    function parseAtom() {
        skipSpaces();
        if (peek() === '(') {
            consume(); // (
            const result = parseExpr();
            skipSpaces();
            if (peek() === ')') consume(); // )
            return result;
        }
        // Parse number
        let numStr = '';
        while (pos < expr.length && (expr[pos] === '.' || (expr[pos] >= '0' && expr[pos] <= '9'))) {
            numStr += consume();
        }
        if (numStr === '' || numStr === '.') throw new Error(`Unexpected character at position ${pos}: ${peek()}`);
        return parseFloat(numStr);
    }

    const result = parseExpr();
    skipSpaces();
    if (pos < expr.length) throw new Error(`Unexpected character at position ${pos}: ${peek()}`);
    return result;
}

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
        // Only allow numbers, operators, dots, and parentheses.
        try {
            // Sanitize: reject any characters that aren't numbers, operators, dots, spaces, or parens
            if (/[^0-9. \/\*\+\-\(\)\^]/.test(expression)) {
                return NaN;
            }

            // Balance can be a float; truncate to integer result
            const result = safeMathEval(expression);

            if (!isFinite(result)) return NaN;

            return Math.floor(result);
        } catch (err) {
            logger.error(`[betparse] Failed to evaluate bet expression "${bet}": ${err.message}`);
            return NaN;
        }
    }
}