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

function detailOf(game, r) {
  if (game === "slots") {
    if (r.is_jackpot) return "jackpot";
    if (r.is_fullscreen) return "full screen";
    if (r.is_free) return "free spin";
    const lines = Array.isArray(r.winning_lines) ? r.winning_lines.length : 0;
    return lines > 0 ? `${lines} winning line${lines === 1 ? "" : "s"}` : "no lines";
  }
  if (game === "blackjack") return r.outcome || null;
  if (game === "roulette") return toNumber(r.winning_number) !== null ? `landed ${r.winning_number} ${r.color || ""}`.trim() : null;
  if (game === "craps") return r.dice ? `rolled ${r.dice.total} (${r.roll_type || "roll"})` : null;
  if (game === "race") {
    const first = Array.isArray(r.finish_order) ? r.finish_order.find(p => p && p.place === 1) : null;
    return first ? `${first.name} won` : null;
  }
  if (game === "poker") return r.hand_name || null;
  if (game === "flip") return r.outcome === "win" ? "called it" : "missed";
  if (game === "keno") {
    const spots = Array.isArray(r.spots) ? r.spots.length : null;
    if (spots === null || toNumber(r.matches) === null) return null;
    return `${r.matches}/${spots} hit`;
  }
  if (game === "rob") return r.victim_id ? `<@${r.victim_id}> — ${r.outcome === "success" ? "got away with it" : "caught"}` : r.outcome || null;
  if (game === "duel") {
    const opponent = r.opponent_id && r.challenger_id ? `<@${r.opponent_id}> vs <@${r.challenger_id}>` : null;
    return opponent;
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
    detail: detailOf(game, r),
  };
}

function formatSigned(amount) {
  if (amount === 0) return "±0";
  return `${amount > 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("en-US")}`;
}

function formatHistoryLine(row) {
  const s = summarizeGameResult(row);
  const parts = [`${OUTCOME_ICONS[s.outcome] || "⚪"} **${s.label}**`, `**${formatSigned(s.net)}**`];
  if (s.wagered !== null) parts.push(`bet ${s.wagered.toLocaleString("en-US")}`);
  if (s.detail) parts.push(s.detail);
  if (s.playedAt !== null) parts.push(`<t:${Math.floor(s.playedAt / 1000)}:R>`);
  return parts.join(" · ");
}

function summarizeHistory(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.reduce((acc, row) => {
    const s = summarizeGameResult(row);
    acc.net += s.net;
    acc.wagered += s.wagered ?? 0;
    if (s.outcome === "win") acc.wins += 1;
    else if (s.outcome === "loss") acc.losses += 1;
    return acc;
  }, { net: 0, wagered: 0, wins: 0, losses: 0 });
}

module.exports = { GAME_LABELS, summarizeGameResult, formatHistoryLine, formatSigned, summarizeHistory };
