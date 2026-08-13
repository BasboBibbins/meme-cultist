module.exports = {
  formatTimeLeft: async function (targetTimestamp) {
    return `<t:${Math.floor(targetTimestamp / 1000)}:R>`;
  },
  formatTimeSince: async function (startTimestamp) {
    return `<t:${Math.floor(startTimestamp / 1000)}:R>`;
  },
  // Discord's epoch syntax cannot express a duration, only an instant.
  formatDuration: function (ms) {
    const total = Math.max(Math.floor(Number(ms) || 0), 0);
    if (total < 1000) return "0 seconds";
    const units = [
      { label: "day", size: 86400000 },
      { label: "hour", size: 3600000 },
      { label: "minute", size: 60000 },
      { label: "second", size: 1000 },
    ];
    const parts = [];
    let remaining = total;
    for (const unit of units) {
      const count = Math.floor(remaining / unit.size);
      remaining -= count * unit.size;
      if (count > 0) parts.push(`${count} ${unit.label}${count === 1 ? "" : "s"}`);
      if (parts.length === 2) break;
    }
    return parts.join(" ");
  },
  // "every 1 day" is not English; "every day" is. Only for the "every X" construction.
  formatInterval: function (ms) {
    return module.exports.formatDuration(ms).replace(/^1 (\w+)$/, "$1");
  },
  todayStamp: function () {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
};
