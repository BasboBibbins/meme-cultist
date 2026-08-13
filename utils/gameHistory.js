const GAME_LABELS = {
  blackjack: "Blackjack",
  craps: "Craps",
  duel: "Duel",
  flip: "Coinflip",
  keno: "Keno",
  poker: "Poker",
  race: "Race",
  rob: "Rob",
  roulette: "Roulette",
  slots: "Slots",
};

const OUTCOME_ICONS = { win: "🟢", loss: "🔴", push: "⚪", draw: "⚪" };

// A row has to survive Discord's mobile column, which is roughly a third of the desktop width.
const MAX_DETAIL = 22;

function clip(text, max) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumBets(bets) {
  if (!Array.isArray(bets)) return null;
  const total = bets.reduce((sum, b) => sum + (toNumber(b?.amount) ?? 0), 0);
  return total > 0 ? total : null;
}

// rob stakes nothing, so null drops the wager segment rather than printing "bet 0".
function wageredOf(game, r) {
  if (game === "rob") return null;
  if (game === "race") return sumBets(r.bets);
  return toNumber(r.total_cost) ?? toNumber(r.total_bet) ?? toNumber(r.total_wagered) ?? toNumber(r.bet);
}

function netOf(r) {
  return toNumber(r.net) ?? 0;
}

function outcomeOf(game, r) {
  const net = netOf(r);
  if (game === "duel" && typeof r.outcome === "string" && r.outcome.includes("draw")) return "draw";
  if (net > 0) return "win";
  if (net < 0) return "loss";
  return "push";
}

function detailOf(game, r, viewerId) {
  if (game === "slots") {
    if (r.is_jackpot) return "jackpot";
    if (r.is_fullscreen) return "full screen";
    if (r.is_free) return "free spin";
    const lines = Array.isArray(r.winning_lines) ? r.winning_lines.length : 0;
    return lines > 0 ? `${lines} winning line${lines === 1 ? "" : "s"}` : "no lines";
  }
  // "win" and "loss" restate the icon and the sign, so only the outcomes that surprise survive.
  if (game === "blackjack") return ["push", "blackjack", "forfeit", "surrender"].includes(r.outcome) ? r.outcome : null;
  if (game === "roulette") return toNumber(r.winning_number) !== null ? `${r.winning_number} ${r.color || ""}`.trim() : null;
  if (game === "craps") return r.dice ? `rolled ${r.dice.total}` : null;
  if (game === "race") {
    const first = Array.isArray(r.finish_order) ? r.finish_order.find(p => p && p.place === 1) : null;
    return first ? `${clip(first.name, MAX_DETAIL)} won` : null;
  }
  if (game === "poker") return r.hand_name ? clip(r.hand_name, MAX_DETAIL) : null;
  if (game === "flip") return null;
  if (game === "keno") {
    const spots = Array.isArray(r.spots) ? r.spots.length : null;
    if (spots === null || toNumber(r.matches) === null) return null;
    return `${r.matches}/${spots} hit`;
  }
  if (game === "rob") return r.victim_id ? `${r.outcome === "success" ? "took from" : "caught by"} <@${r.victim_id}>` : null;
  // It is your own history, so naming both duellists spends the row's widest segment on what you already know.
  if (game === "duel") {
    const other = viewerId && r.challenger_id === viewerId ? r.opponent_id : r.challenger_id;
    return other ? `vs <@${other}>` : null;
  }
  return null;
}

function summarizeGameResult(row) {
  const game = row?.game || "unknown";
  const r = row?.result && typeof row.result === "object" ? row.result : {};
  return {
    game,
    label: GAME_LABELS[game] || game,
    playedAt: toNumber(row?.played_at),
    wagered: wageredOf(game, r),
    net: netOf(r),
    outcome: outcomeOf(game, r),
    detail: detailOf(game, r, row?.user_id),
  };
}

function formatSigned(amount) {
  if (amount === 0) return "±0";
  return `${amount > 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("en-US")}`;
}

// No per-row timestamp: newest-first ordering already says it, and the chip is the widest segment.
function formatHistoryLine(row) {
  const s = summarizeGameResult(row);
  const head = `${OUTCOME_ICONS[s.outcome] || "⚪"} **${s.label}** **${formatSigned(s.net)}**`;
  const tail = [];
  // On a total loss the stake and the net are the same number, so printing both says it twice.
  if (s.wagered !== null && s.net !== -s.wagered) tail.push(`bet ${s.wagered.toLocaleString("en-US")}`);
  if (s.detail) tail.push(s.detail);
  return tail.length ? `${head} · ${tail.join(" · ")}` : head;
}

function historySpan(rows) {
  const times = (Array.isArray(rows) ? rows : []).map(r => toNumber(r?.played_at)).filter(t => t !== null);
  if (times.length === 0) return null;
  return { oldest: Math.min(...times), newest: Math.max(...times) };
}

function summarizeHistory(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.reduce((acc, row) => {
    const s = summarizeGameResult(row);
    acc.net += s.net;
    acc.wagered += s.wagered ?? 0;
    if (s.outcome === "win") acc.wins += 1;
    else if (s.outcome === "loss") acc.losses += 1;
    else acc.pushes += 1;
    return acc;
  }, { net: 0, wagered: 0, wins: 0, losses: 0, pushes: 0 });
}

module.exports = { GAME_LABELS, summarizeGameResult, formatHistoryLine, formatSigned, summarizeHistory, historySpan };
