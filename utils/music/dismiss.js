// Ephemeral confirmations clean themselves up after a beat. Scheduled rather than
// awaited: awaiting a ten second sleep inside execute() holds the command handler
// open, which delays the stats write behind it and makes the command look hung.

const logger = require("../logger");

function autoDismiss(interaction, delayMs) {
  const timer = setTimeout(() => {
    interaction.deleteReply().catch(err => logger.debug(`[Music] Auto-dismiss failed: ${err.message}`));
  }, delayMs);
  // The bot outlives any one reply, so a pending dismissal must never hold the process open.
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

module.exports = { autoDismiss };
