module.exports = {
  formatTimeLeft: async function (timeLeft) {
    const d = Math.floor(timeLeft / 8.64e+7);
    const h = timeLeft.getUTCHours()
    const m = timeLeft.getUTCMinutes()
    const s = timeLeft.getUTCSeconds()
    return `${d>0?d+'d ':''}${h>0?h+'h ':''}${m>0?m+'m ':''}${s>0?s+'s':''}`;
  },
  formatTimeSince: async function (time) {
    const d = Math.floor(time / 86400000);
    const h = Math.floor(time / 3600000) % 24;
    const m = Math.floor(time / 60000) % 60;
    const s = Math.floor(time / 1000) % 60;
    return `${d>0?d+'d ':''}${h>0?h+'h ':''}${m>0?m+'m ':''}${s>0?s+'s':''}`;
  }
}