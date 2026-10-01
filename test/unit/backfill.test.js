const { isArchivable, oldestMessageId, backfillPages, runFullBackfill, enqueueBackfill, makeBackfill } = require("../../utils/jobs/backfillHandlers");

const OPTS = { oocPrefix: ">", bannedRoleId: "banned" };
const msg = (overrides = {}) => ({ id: "10", author: { id: "u1" }, content: "hello", member: { roles: { cache: [] } }, ...overrides });

function fakeChannel(count) {
  const all = Array.from({ length: count }, (_, i) => ({ id: String(1000 + i), createdTimestamp: 1_700_000_000_000 + i }));
  const calls = [];
  return {
    calls,
    messages: {
      fetch: async ({ limit, before }) => {
        calls.push(before ?? null);
        const older = before ? all.filter(m => BigInt(m.id) < BigInt(before)) : all;
        const page = older.slice(-limit).reverse();
        return new Map(page.map(m => [m.id, m]));
      },
    },
  };
}

function fakeJobs() {
  const rows = [];
  return {
    rows,
    list: (kind, filter) => rows.filter(r => r.kind === kind && r.status === "pending").filter(filter),
    enqueue: (job) => rows.push({ id: rows.length + 1, kind: job.kind, status: "pending", payload: JSON.stringify(job.payload), run_at: job.run_at }),
  };
}

describe("isArchivable", () => {
  test("keeps an ordinary message", () => {
    expect(isArchivable(msg(), OPTS)).toBe(true);
  });

  test("keeps a message from someone who has since left the server", () => {
    expect(isArchivable(msg({ member: null }), OPTS)).toBe(true);
  });

  test.each([
    ["empty content", { content: "" }],
    ["webhook post", { webhookId: "w1" }],
    ["system message", { system: true }],
    ["thread starter", { hasThread: true }],
    ["out of character", { content: "> ignore me" }],
    ["typing placeholder", { content: "⏳ thinking" }],
    ["banned author", { member: { roles: { cache: [{ id: "banned" }] } } }],
  ])("skips a %s", (_, overrides) => {
    expect(isArchivable(msg(overrides), OPTS)).toBe(false);
  });
});

describe("oldestMessageId", () => {
  test("compares snowflakes numerically, not as strings", () => {
    expect(oldestMessageId(["99", "1000", "150"])).toBe("99");
  });
});

describe("backfillPages", () => {
  test("a full scan visits every message exactly once and stops at the channel start", async () => {
    const channel = fakeChannel(250);
    const seen = [];
    const result = await backfillPages(channel, { maxPages: 10, archive: (m) => { seen.push(m.id); return true; } });
    expect(new Set(seen).size).toBe(250);
    expect(seen).toHaveLength(250);
    expect(result).toMatchObject({ done: true, scanned: 250, inserted: 250, cursor: "1000" });
    expect(channel.calls).toEqual([null, "1150", "1050"]);
  });

  test("a scan split across runs resumes from the cursor without overlap", async () => {
    const channel = fakeChannel(250);
    const seen = [];
    const archive = (m) => { seen.push(m.id); return true; };
    const first = await backfillPages(channel, { maxPages: 1, archive });
    expect(first).toMatchObject({ done: false, cursor: "1150" });
    const second = await backfillPages(channel, { before: first.cursor, maxPages: 10, archive });
    expect(second.done).toBe(true);
    expect(new Set(seen).size).toBe(250);
    expect(seen).toHaveLength(250);
  });

  test("an exact multiple of the page size ends on an empty page", async () => {
    const result = await backfillPages(fakeChannel(200), { maxPages: 10, archive: () => false });
    expect(result).toMatchObject({ done: true, scanned: 200, inserted: 0 });
  });
});

describe("runFullBackfill", () => {
  test("runs batch after batch to the channel start and reports progress for each", async () => {
    const progress = [];
    const seen = new Set();
    const result = await runFullBackfill(fakeChannel(250), {
      archive: (m) => { seen.add(m.id); return m.id.endsWith("0"); },
      pagesPerRun: 1,
      onProgress: (p) => progress.push(p),
    });
    expect(seen.size).toBe(250);
    expect(result).toMatchObject({ scanned: 250, inserted: 25 });
    expect(progress.map(p => p.done)).toEqual([false, false, true]);
    expect(progress.map(p => p.scanned)).toEqual([100, 200, 250]);
  });

  test("an empty channel finishes on the first request", async () => {
    const result = await runFullBackfill(fakeChannel(0), { archive: () => true, pagesPerRun: 20 });
    expect(result).toMatchObject({ scanned: 0, inserted: 0, oldestAt: null });
  });
});

describe("enqueueBackfill", () => {
  test("allows one queued scan per channel", () => {
    const jobs = fakeJobs();
    expect(enqueueBackfill(jobs, "c1")).toBe(true);
    expect(enqueueBackfill(jobs, "c1")).toBe(false);
    expect(enqueueBackfill(jobs, "c2")).toBe(true);
  });

  test("the running job can queue its own successor", () => {
    const jobs = fakeJobs();
    enqueueBackfill(jobs, "c1");
    expect(enqueueBackfill(jobs, "c1", { before: "5", excludeJobId: 1 })).toBe(true);
    expect(JSON.parse(jobs.rows[1].payload)).toEqual({ channelId: "c1", before: "5" });
  });
});

describe("makeBackfill", () => {
  test("requeues with the cursor until the channel start, then stops", async () => {
    const jobs = fakeJobs();
    const inserted = [];
    const run = makeBackfill({
      jobs,
      fetchChannel: async () => fakeChannel(250),
      archiveMessage: async () => true,
      onInserted: (id) => inserted.push(id),
      pagesPerRun: 2,
      delayMs: 0,
    });
    await run({ channelId: "c1", before: null }, { jobId: 99 });
    expect(JSON.parse(jobs.rows[0].payload)).toEqual({ channelId: "c1", before: "1050" });
    await run({ channelId: "c1", before: "1050" }, { jobId: 1 });
    expect(jobs.rows).toHaveLength(1);
    expect(inserted).toEqual(["c1", "c1"]);
  });

  test("accepts the old channelIds payload as a fresh scan", async () => {
    const fetched = [];
    const run = makeBackfill({
      jobs: fakeJobs(),
      fetchChannel: async (id) => { fetched.push(id); return fakeChannel(10); },
      archiveMessage: async () => false,
      onInserted: () => {},
      pagesPerRun: 5,
      delayMs: 0,
    });
    await run({ channelIds: ["a", "b"] });
    expect(fetched).toEqual(["a", "b"]);
  });
});
