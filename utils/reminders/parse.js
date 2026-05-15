const chrono = require("chrono-node");
const logger = require("../logger");

function parseWhen(text, referenceDate = new Date()) {
    if (!text || typeof text !== "string") {
        return { ok: false, runAt: null, reason: "No time provided." };
    }
    try {
        const result = chrono.parseDate(text.trim(), referenceDate);
        if (!result) {
            return { ok: false, runAt: null, reason: `Could not understand "${text}". Try formats like "in 2 hours", "tomorrow at 3pm", or "5 minutes".` };
        }
        const runAt = result.getTime();
        if (runAt <= Date.now()) {
            return { ok: false, runAt: null, reason: "That time is in the past. Please specify a future time." };
        }
        return { ok: true, runAt, reason: null };
    } catch (err) {
        logger.warn(`[Reminders] chrono-node parse error: ${err.message}`);
        return { ok: false, runAt: null, reason: "Failed to parse the time. Try a clearer format." };
    }
}

function parseRecurring(text, referenceDate = new Date()) {
    if (!text || typeof text !== "string") {
        return { ok: false, reason: "No time provided." };
    }
    try {
        const result = chrono.parseDate(text.trim(), referenceDate);
        if (!result) {
            return { ok: false, reason: `Could not understand "${text}". Try formats like "in 2 hours", "tomorrow at 3pm", or "5 minutes".` };
        }
        const firstRunAt = result.getTime();
        if (firstRunAt <= Date.now()) {
            return { ok: false, reason: "That time is in the past. Please specify a future time." };
        }

        const lowered = text.toLowerCase();
        let frequency = null;
        let intervalMs = null;
        if (lowered.includes("every day") || lowered.includes("daily")) {
            frequency = "daily";
            intervalMs = 24 * 60 * 60 * 1000;
        } else if (lowered.includes("every week") || lowered.includes("weekly")) {
            frequency = "weekly";
            intervalMs = 7 * 24 * 60 * 60 * 1000;
        }

        return { ok: true, firstRunAt, frequency, intervalMs };
    } catch (err) {
        logger.warn(`[Reminders] chrono-node parseRecurring error: ${err.message}`);
        return { ok: false, reason: "Failed to parse the time. Try a clearer format." };
    }
}

module.exports = { parseWhen, parseRecurring };
