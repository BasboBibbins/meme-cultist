
export async function formatTimeLeft(timeLeft) {
  var d = Math.floor(timeLeft / 8.64e+7);
  var h = timeLeft.getUTCHours()
  var m = timeLeft.getUTCMinutes()
  var s = timeLeft.getUTCSeconds()
  return `${d<=0?d+'d ':''}${h<=0?h+'h ':''}${m<=0?m+'m ':''}${s<=0?s+'s':''}`;
}