const { claimSession, releaseSession } = require("../../utils/sessionClaim");

describe("claimSession", () => {
  test("claims an empty slot and writes the claim into the map", () => {
    const sessions = new Map();
    const { claim, existing } = claimSession(sessions, "chan");

    expect(existing).toBeNull();
    expect(claim).not.toBeNull();
    expect(sessions.get("chan")).toBe(claim);
  });

  test("a claim carries both guard keys so every game's occupancy check rejects it", () => {
    const sessions = new Map();
    const { claim } = claimSession(sessions, "chan");

    expect(claim.status).toBe("starting");
    expect(claim.phase).toBe("starting");
  });

  test("refuses an occupied slot and hands back the occupant", () => {
    const sessions = new Map();
    const live = { status: "active" };
    sessions.set("chan", live);

    const { claim, existing } = claimSession(sessions, "chan");

    expect(claim).toBeNull();
    expect(existing).toBe(live);
    expect(sessions.get("chan")).toBe(live);
  });

  test("refuses a slot held by an in-flight claim", () => {
    const sessions = new Map();
    const first = claimSession(sessions, "chan");
    const second = claimSession(sessions, "chan");

    expect(second.claim).toBeNull();
    expect(second.existing).toBe(first.claim);
  });

  test("treats an ended session as vacant", () => {
    const sessions = new Map();
    sessions.set("chan", { status: "ended" });

    const { claim, existing } = claimSession(sessions, "chan");

    expect(existing).toBeNull();
    expect(sessions.get("chan")).toBe(claim);
  });

  test("keys are independent", () => {
    const sessions = new Map();
    claimSession(sessions, "a");
    const { claim } = claimSession(sessions, "b");

    expect(claim).not.toBeNull();
    expect(sessions.size).toBe(2);
  });
});

describe("releaseSession", () => {
  test("clears the slot it claimed", () => {
    const sessions = new Map();
    const { claim } = claimSession(sessions, "chan");

    releaseSession(sessions, "chan", claim);

    expect(sessions.has("chan")).toBe(false);
  });

  test("is a no-op once the real session has replaced the claim", () => {
    const sessions = new Map();
    const { claim } = claimSession(sessions, "chan");
    const session = { status: "active" };
    sessions.set("chan", session);

    releaseSession(sessions, "chan", claim);

    expect(sessions.get("chan")).toBe(session);
  });

  test("never clears another caller's entry", () => {
    const sessions = new Map();
    const stale = { status: "starting" };
    const live = { status: "active" };
    sessions.set("chan", live);

    releaseSession(sessions, "chan", stale);

    expect(sessions.get("chan")).toBe(live);
  });
});
