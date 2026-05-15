const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require("discord.js");
const { addNewDBUser, db } = require("../database");
const { CURRENCY_NAME } = require("../config.js");
const { parseBet } = require("./betparse");

const PACKAGE_VERSION = require("../package.json").version;
const DEFAULT_TIMEOUT_MS = 60000;

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
// Returns { amount, submit } on success; null on either validation failure
// (helper already replied with a themed error embed) or modal abandon
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
    } = opts;

    const client = buttonInt.client;
    const modalId = `betmodal_${buttonInt.id}`;

    if (extras.length > 4) {
        throw new Error(`openBetModal: at most 4 extras allowed (Discord modal cap is 5 inputs, amount uses 1). Got ${extras.length}.`);
    }

    const rows = [
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId("amount")
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(placeholder)
                .setRequired(true),
        ),
    ];
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

    let dbUser = await db.get(user.id);
    if (!dbUser) {
        await addNewDBUser(user);
        dbUser = await db.get(user.id);
    }
    if ((dbUser?.balance || 0) < amount) {
        await submit.reply({ embeds: [buildErrorEmbed(user, client, `Insufficient funds in wallet!`)], ephemeral: true });
        return null;
    }

    return { amount, submit };
}

module.exports = { openBetModal };
