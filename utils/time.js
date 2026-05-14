module.exports = {
  formatTimeLeft: async function (targetTimestamp) {
    return `<t:${Math.floor(targetTimestamp / 1000)}:R>`;
  },
  formatTimeSince: async function (startTimestamp) {
    return `<t:${Math.floor(startTimestamp / 1000)}:R>`;
  }
};
