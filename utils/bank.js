const { db } = require("../database");
const logger = require("./logger");
const { INTEREST_TIERS, INTEREST_ACTIVE_WINDOW_DAYS } = require("../config.js");
const { computeInterest, isActive } = require("./interest");
const { withUserLock } = require("./userlock");

module.exports = {
  interest: async function () {
    const users = await db.all();
    const now = Date.now();
    let paidUsers = 0;
    let inactiveUsers = 0;
    let totalPaid = 0;
    for (const user of users) {
      if (!(user.value?.bank > 0)) continue;
      if (!isActive(user.value, now, INTEREST_ACTIVE_WINDOW_DAYS)) {
        inactiveUsers++;
        continue;
      }
      const paid = await withUserLock(user.id, async () => {
        const amount = computeInterest(await db.get(`${user.id}.bank`), INTEREST_TIERS);
        if (amount <= 0) return 0;
        await db.add(`${user.id}.bank`, amount);
        await db.add(`${user.id}.stats.interest.earned`, amount);
        await db.set(`${user.id}.stats.interest.lastAmount`, amount);
        await db.set(`${user.id}.stats.interest.lastAt`, now);
        return amount;
      });
      if (paid > 0) {
        paidUsers++;
        totalPaid += paid;
        logger.debug(`Interest added to ${user.value.name} (${user.id}). Interest: ${paid}`);
      }
    }
    logger.info(`Interest paid ${totalPaid.toLocaleString("en-US")} to ${paidUsers} users. ${inactiveUsers} inactive users skipped.`);
  },
  parseAmount: async function (amount, id, subcommand) {
    const dbUser = await db.get(id);
    const balance = subcommand === "withdraw" ? dbUser.bank : dbUser.balance;

    if (amount === "all" || amount === "max" || amount === "maxamount") {
      return balance;
    }
    if (amount === "half") {
      return Math.round(balance / 2);
    }
    if (amount === "quarter") {
      return Math.round(balance / 4);
    }
    if (amount === "eighth") {
      return Math.round(balance / 8);
    }
    if (amount.includes("/")) {
      const betSplit = amount.split("/");
      return Math.floor(betSplit[0] / betSplit[1]);
    }
    if (amount.includes("*")) {
      const betSplit = amount.split("*");
      return Math.floor(betSplit[0] * betSplit[1]);
    }
    if (amount.includes("+")) {
      const betSplit = amount.split("+");
      return Math.floor(betSplit[0] + betSplit[1]);
    }
    if (amount.includes("-")) {
      const betSplit = amount.split("-");
      return Math.floor(betSplit[0] - betSplit[1]);
    }
    if (amount.includes("%")) {
      const betSplit = amount.split("%");
      return Math.floor(betSplit[0] * (betSplit[1] / 100));
    }
    if (amount.includes("^")) {
      const betSplit = amount.split("^");
      return Math.floor(betSplit[0] ** betSplit[1]);
    }
    return Number(amount);
  },
  deposit: async function (id, amount) {
    await db.sub(`${id}.balance`, amount);
    await db.add(`${id}.bank`, amount);
  },
  withdraw: async function (id, amount) {
    await db.sub(`${id}.bank`, amount);
    await db.add(`${id}.balance`, amount);
  },
  getCurrentTopUsers: async () => {
    const users = await db.all();
    logger.debug("Getting current top users...");
    for (const user of users) {
      if (user.value.name === undefined) {
        await db.delete(user.id);
        logger.warn(`User ${user.id} has corrupted data, deleting...`);
        continue;
      }
      const bank = await db.get(`${user.id}.bank`);
      logger.debug(`${user.value.name} (${user.id}): ${bank}`);
      user.value.bank = bank;
    }
    const topUsers = users.sort((a, b) => b.value.bank - a.value.bank).slice(0, 10);
    return topUsers;
  },
  getAllTimeTopUsers: async () => {
    const users = await db.all();
    logger.debug("Getting all-time top users...");
    for (const user of users) {
      if (user.value.name === undefined) {
        await db.delete(user.id);
        logger.warn(`User ${user.id} has corrupted data, deleting...`);
        continue;
      }
      const largestBank = await db.get(`${user.id}.stats.largestBank`);
      const bank = await db.get(`${user.id}.bank`);
      if (bank > largestBank || !largestBank) {
        await db.set(`${user.id}.stats.largestBank`, bank);
      }
      logger.debug(`${user.value.name} (${user.id}): ${largestBank} (largestBank) | ${bank} (bank)`);
      user.value.stats.largestBank = largestBank;
    }
    const topUsers = users.sort((a, b) => b.value.stats.largestBank - a.value.stats.largestBank).slice(0, 10);
    return topUsers;
  }
};