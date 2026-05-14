module.exports = {
  formatTimeLeft: async function (targetTimestamp) {
    return `<t:${Math.floor(targetTimestamp / 1000)}:R>`;
  },
  formatTimeSince: async function (startTimestamp) {
    return `<t:${Math.floor(startTimestamp / 1000)}:R>`;
  },
  todayStamp: function () {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
};
