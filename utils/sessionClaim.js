// The slot must be taken before the first await, or two concurrent starts both clear the guard and orphan one session.
function claimSession(sessions, key) {
  const existing = sessions.get(key);
  if (existing && existing.status !== "ended") return { existing, claim: null };

  // Both keys are set because the games guard on `status` and race guards on `phase`.
  const claim = { status: "starting", phase: "starting", claimedAt: Date.now() };
  sessions.set(key, claim);
  return { existing: null, claim };
}

function releaseSession(sessions, key, claim) {
  if (sessions.get(key) === claim) sessions.delete(key);
}

module.exports = { claimSession, releaseSession };
