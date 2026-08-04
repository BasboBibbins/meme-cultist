// Regression guard for silent embedding work-loss.
//
// These handlers used to catch their own errors and return normally. The queue
// then marked the job 'done', so a failed embedding was never retried and left
// no trace — the KB entry or chunk simply stayed unembedded forever. Nothing
// looked broken, because FTS keeps serving retrieval either way.
//
// Every test here exists to pin one rule: if work did not get done, the handler
// must throw, because throwing is the only signal the queue understands.

const { makeKbEmbed, makeMessageEmbed, makeEpisodeEmbed } = require("../../utils/jobs/embedHandlers");

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const EMBEDDING = [0.1, 0.2, 0.3];

function makeLlm(impl) {
  return { embed: jest.fn(impl ?? (async () => ({ embedding: EMBEDDING }))) };
}

describe("kb_embed", () => {
  const entry = { title: "Dailies", content: "Claim koku daily." };

  test("embeds and stores on the happy path", async () => {
    const kbStore = { getBySlug: jest.fn(() => entry), setEmbedding: jest.fn() };
    const llm = makeLlm();
    await makeKbEmbed({ kbStore, llm })({ guildId: "g1", slug: "dailies" });
    expect(kbStore.setEmbedding).toHaveBeenCalledWith("g1", "dailies", EMBEDDING);
  });

  test("throws when the embedding call fails, so the queue retries", async () => {
    const kbStore = { getBySlug: jest.fn(() => entry), setEmbedding: jest.fn() };
    const llm = makeLlm(async () => { throw new Error("embed timed out (30000ms)"); });

    await expect(makeKbEmbed({ kbStore, llm })({ guildId: "g1", slug: "dailies" }))
      .rejects.toThrow(/timed out/);
    expect(kbStore.setEmbedding).not.toHaveBeenCalled();
  });

  test("returns quietly for a deleted entry — retrying cannot fix that", async () => {
    const kbStore = { getBySlug: jest.fn(() => null), setEmbedding: jest.fn() };
    const llm = makeLlm();
    await expect(makeKbEmbed({ kbStore, llm })({ guildId: "g1", slug: "gone" })).resolves.toBeUndefined();
    expect(llm.embed).not.toHaveBeenCalled();
  });
});

describe("message_embed", () => {
  const chunks = [
    { id: 1, content: "one" },
    { id: 2, content: "two" },
    { id: 3, content: "three" },
  ];

  function makeArchive(rows = chunks) {
    return { getUnembeddedForChannel: jest.fn(() => rows.map(r => ({ ...r }))), setEmbedding: jest.fn() };
  }

  test("embeds every chunk on the happy path and does not throw", async () => {
    const messageArchive = makeArchive();
    const llm = makeLlm();
    await expect(makeMessageEmbed({ messageArchive, llm })({ channelId: "c1", chunkIds: [] }))
      .resolves.toBeUndefined();
    expect(messageArchive.setEmbedding).toHaveBeenCalledTimes(3);
  });

  test("a partial failure still fails the job so the remainder is retried", async () => {
    const messageArchive = makeArchive();
    const llm = makeLlm(async ({ text }) => {
      if (text === "two") throw new Error("upstream 503");
      return { embedding: EMBEDDING };
    });

    await expect(makeMessageEmbed({ messageArchive, llm })({ channelId: "c1", chunkIds: [] }))
      .rejects.toThrow(/1\/3 chunks failed/);
    // The two that worked are still committed — the retry re-queries
    // `embedding IS NULL` and picks up only the outstanding one.
    expect(messageArchive.setEmbedding).toHaveBeenCalledTimes(2);
  });

  test("one bad chunk does not abandon the rest of the batch", async () => {
    const messageArchive = makeArchive();
    const llm = makeLlm(async ({ text }) => {
      if (text === "one") throw new Error("bad chunk");
      return { embedding: EMBEDDING };
    });

    await expect(makeMessageEmbed({ messageArchive, llm })({ channelId: "c1", chunkIds: [] }))
      .rejects.toThrow();
    // Chunks two and three were attempted despite the first one throwing.
    expect(llm.embed).toHaveBeenCalledTimes(3);
    expect(messageArchive.setEmbedding).toHaveBeenCalledTimes(2);
  });

  test("a total failure throws rather than reporting success", async () => {
    const messageArchive = makeArchive();
    const llm = makeLlm(async () => { throw new Error("network down"); });

    await expect(makeMessageEmbed({ messageArchive, llm })({ channelId: "c1", chunkIds: [] }))
      .rejects.toThrow(/3\/3 chunks failed/);
    expect(messageArchive.setEmbedding).not.toHaveBeenCalled();
  });

  test("nothing outstanding is a no-op, not a failure", async () => {
    const messageArchive = makeArchive([]);
    const llm = makeLlm();
    await expect(makeMessageEmbed({ messageArchive, llm })({ channelId: "c1", chunkIds: [] }))
      .resolves.toBeUndefined();
    expect(llm.embed).not.toHaveBeenCalled();
  });

  test("honours an explicit chunkIds filter", async () => {
    const messageArchive = makeArchive();
    const llm = makeLlm();
    await makeMessageEmbed({ messageArchive, llm })({ channelId: "c1", chunkIds: [2] });
    expect(llm.embed).toHaveBeenCalledTimes(1);
    expect(messageArchive.setEmbedding).toHaveBeenCalledWith(2, EMBEDDING);
  });
});

describe("episode_embed", () => {
  const eps = [{ id: 10, summary: "alpha" }, { id: 11, summary: "beta" }];

  function makeStore(rows = eps) {
    return { getByIds: jest.fn(() => rows.map(r => ({ ...r }))), setEmbedding: jest.fn() };
  }

  test("embeds every episode on the happy path", async () => {
    const episodeStore = makeStore();
    const llm = makeLlm();
    await expect(makeEpisodeEmbed({ episodeStore, llm })({ episodeIds: [10, 11] }))
      .resolves.toBeUndefined();
    expect(episodeStore.setEmbedding).toHaveBeenCalledTimes(2);
  });

  test("a partial failure fails the job", async () => {
    const episodeStore = makeStore();
    const llm = makeLlm(async ({ text }) => {
      if (text === "beta") throw new Error("rate limited");
      return { embedding: EMBEDDING };
    });

    await expect(makeEpisodeEmbed({ episodeStore, llm })({ episodeIds: [10, 11] }))
      .rejects.toThrow(/1\/2 episodes failed/);
    expect(episodeStore.setEmbedding).toHaveBeenCalledTimes(1);
  });

  test("an empty id list is a no-op", async () => {
    const episodeStore = makeStore();
    const llm = makeLlm();
    await expect(makeEpisodeEmbed({ episodeStore, llm })({ episodeIds: [] })).resolves.toBeUndefined();
    expect(episodeStore.getByIds).not.toHaveBeenCalled();
  });

  test("already-embedded episodes are a no-op", async () => {
    const episodeStore = makeStore([]);
    const llm = makeLlm();
    await expect(makeEpisodeEmbed({ episodeStore, llm })({ episodeIds: [10] })).resolves.toBeUndefined();
    expect(llm.embed).not.toHaveBeenCalled();
  });
});
