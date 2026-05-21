const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require("discord.js");
const { addNewDBUser, db } = require("../database");
const { CURRENCY_NAME } = require("../config.js");
const { parseBet } = require("./betparse");

const PACKAGE_VERSION = require("../package.json").version;
const DEFAULT_TIMEOUT_MS = 60000;

// Re-resolve a cached bet expression against the user's *current* balance and
// run the same validation chain openBetModal applies at submit time. Returns
// { ok: true, amount } on success, or { ok: false, reason } on failure.
// Callers use this for any bet that was cached as a raw expression string —
// e.g. `max * 0.2` should evaluate to the user's current balance × 0.2, not
// the value frozen the first time they typed it.
async function resolveBet(expression, userId, opts = {}) {
    const { min, max, requireBalance = true } = opts;
    if (typeof expression !== "string" || expression.trim().length === 0) {
        return { ok: false, reason: "Bet expression is empty." };
    }

    const amount = Number(await parseBet(expression, userId));
    if (isNaN(amount) || amount % 1 !== 0) {
        return { ok: false, reason: `\`${expression}\` no longer resolves to a valid whole number of ${CURRENCY_NAME}.` };
    }
    if (amount <= 0) {
        return { ok: false, reason: `\`${expression}\` now resolves to 0 ${CURRENCY_NAME}.` };
    }
    if (min && amount < min) {
        return { ok: false, reason: `\`${expression}\` now resolves to ${amount.toLocaleString("en-US")} — below the ${min.toLocaleString("en-US")} ${CURRENCY_NAME} minimum.` };
    }
    if (max && amount > max) {
        return { ok: false, reason: `\`${expression}\` now resolves to ${amount.toLocaleString("en-US")} — above the ${max.toLocaleString("en-US")} ${CURRENCY_NAME} maximum.` };
    }
    if (requireBalance) {
        const balance = (await db.get(`${userId}.balance`)) ?? 0;
        if (balance < amount) {
            return { ok: false, reason: `Insufficient funds — \`${expression}\` resolves to ${amount.toLocaleString("en-US")} ${CURRENCY_NAME}, you have ${balance.toLocaleString("en-US")}.` };
        }
    }
    return { ok: true, amount };
}

function buildErrorEmbed(user, client, description) {
    return new EmbedBuilder()
        .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setColor(0xFF0000)
        .setDescription(description)
        .setFooter({ text: `${client.user.username} | Version ${PACKAGE_VERSION}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();
}

// Show a one-amount bet modal, parse + validate the response, and (on success)
// hand back the submit interaction so the caller can re-check session state
// and reply. Extras are passed through verbatim — caller reads them via
// submit.fields.getTextInputValue(customId) and validates them itself.
//
// Balance is NOT checked here — there is always a gap between this return and
// the caller's debit, so a check here can never be authoritative. Callers MUST
// re-validate balance (and debit) atomically inside withUserLock. Use
// resolveBet(expression, userId) inside the lock for a consistent check.
//
// Returns { amount, expression, submit } on success; null on either validation
// failure (helper already replied with a themed error embed) or modal abandon
// (no reply made — user just closed the modal).
async function openBetModal(buttonInt, opts) {
    const {
        title,
        label = `Amount of ${CURRENCY_NAME}`,
        placeholder = "e.g. 100, half, max, 50*2",
        min,
        max,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        extras = [],
        defaultAmount,
    } = opts;

    const client = buttonInt.client;
    const modalId = `betmodal_${buttonInt.id}`;

    if (extras.length > 4) {
        throw new Error(`openBetModal: at most 4 extras allowed (Discord modal cap is 5 inputs, amount uses 1). Got ${extras.length}.`);
    }

    const amountInput = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(placeholder)
        .setRequired(true);
    if (typeof defaultAmount === "string" && defaultAmount.length > 0) {
        amountInput.setValue(defaultAmount);
    }
    const rows = [new ActionRowBuilder().addComponents(amountInput)];
    for (const extra of extras) {
        const input = new TextInputBuilder()
            .setCustomId(extra.customId)
            .setLabel(extra.label)
            .setStyle(extra.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(extra.required !== false);
        if (extra.placeholder) input.setPlaceholder(extra.placeholder);
        if (typeof extra.value === "string") input.setValue(extra.value);
        if (typeof extra.minLength === "number") input.setMinLength(extra.minLength);
        if (typeof extra.maxLength === "number") input.setMaxLength(extra.maxLength);
        rows.push(new ActionRowBuilder().addComponents(input));
    }

    const modal = new ModalBuilder().setCustomId(modalId).setTitle(title).addComponents(...rows);
    await buttonInt.showModal(modal);

    let submit;
    try {
        submit = await buttonInt.awaitModalSubmit({
            filter: m => m.customId === modalId && m.user.id === buttonInt.user.id,
            time: timeoutMs,
        });
    } catch {
        return null;
    }

    const user = submit.user;
    const amountStr = submit.fields.getTextInputValue("amount");
    const expression = amountStr.trim();
    const amount = Number(await parseBet(amountStr, user.id));

    if (isNaN(amount) || amount % 1 !== 0) {
        await submit.reply({ embeds: [buildErrorEmbed(user, client, `You must bet a valid whole-number amount of ${CURRENCY_NAME}.`)], ephemeral: true });
        return null;
    }
    if (amount <= 0) {
        await submit.reply({ embeds: [buildErrorEmbed(user, client, `Bet must be greater than zero.`)], ephemeral: true });
        return null;
    }
    if (min && amount < min) {
        await submit.reply({ embeds: [buildErrorEmbed(user, client, `You must bet at least ${min.toLocaleString("en-US")} ${CURRENCY_NAME}!`)], ephemeral: true });
        return null;
    }
    if (max && amount > max) {
        await submit.reply({ embeds: [buildErrorEmbed(user, client, `You can bet at most ${max.toLocaleString("en-US")} ${CURRENCY_NAME}!`)], ephemeral: true });
        return null;
    }

    await addNewDBUser(user);

    return { amount, expression, submit };
}

module.exports = { openBetModal, resolveBet };
