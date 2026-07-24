const {
  recordPerception,
  getRecentPerception,
  perceptionConfidence,
  pruneDanglingToolMessages,
  DIRECTIVE_KEYWORDS,
} = require("../../utils/openai");
const { PERCEPTION_CACHE_SIZE, PERCEPTION_CACHE_TTL_MS } = require("../../config.js");

function fakeClient() {
  return { perceptionCache: new Map() };
}

function entry(overrides = {}) {
  return {
    messageId: "m1",
    authorId: "1",
    authorName: "Alice",
    kind: "image",
    text: "a grey tabby cat asleep on a couch",
    at: Date.now(),
    ...overrides,
  };
}

describe("recordPerception", () => {
  test("truncates stored text so a fetched page body is not pinned", () => {
    const client = fakeClient();
    recordPerception(client, "c1", entry({ kind: "link", text: "x".repeat(4000) }));
    const [stored] = getRecentPerception(client, "c1");
    expect(stored.text.length).toBeLessThanOrEqual(200);
  });

  test("collapses whitespace at record time", () => {
    const client = fakeClient();
    recordPerception(client, "c1", entry({ text: "  a  cat\n\non a   couch " }));
    expect(getRecentPerception(client, "c1")[0].text).toBe("a cat on a couch");
  });

  test("caps entries per channel", () => {
    const client = fakeClient();
    for (let i = 0; i < PERCEPTION_CACHE_SIZE + 4; i++) {
      recordPerception(client, "c1", entry({ messageId: `m${i}`, text: `image number ${i}` }));
    }
    const list = getRecentPerception(client, "c1");
    expect(list).toHaveLength(PERCEPTION_CACHE_SIZE);
    expect(list[list.length - 1].text).toContain(`${PERCEPTION_CACHE_SIZE + 3}`);
  });

  test("sweeps expired entries in OTHER channels on write", () => {
    const client = fakeClient();
    const stale = Date.now() - PERCEPTION_CACHE_TTL_MS - 1000;
    recordPerception(client, "old-channel", entry({ at: stale }));
    expect(client.perceptionCache.has("old-channel")).toBe(true);

    recordPerception(client, "c1", entry());
    // Without the sweep, a channel never visited again would leak forever.
    expect(client.perceptionCache.has("old-channel")).toBe(false);
    expect(client.perceptionCache.has("c1")).toBe(true);
  });

  test("ignores entries with no text", () => {
    const client = fakeClient();
    recordPerception(client, "c1", entry({ text: "" }));
    expect(getRecentPerception(client, "c1")).toEqual([]);
  });

  test("lazily creates the cache when absent", () => {
    const client = {};
    recordPerception(client, "c1", entry());
    expect(getRecentPerception(client, "c1")).toHaveLength(1);
  });
});

describe("getRecentPerception", () => {
  test("drops expired entries and deletes the empty channel key", () => {
    const client = fakeClient();
    recordPerception(client, "c1", entry({ at: Date.now() - PERCEPTION_CACHE_TTL_MS - 1 }));
    expect(getRecentPerception(client, "c1")).toEqual([]);
    expect(client.perceptionCache.has("c1")).toBe(false);
  });

  test("returns an empty array for an unknown channel or missing cache", () => {
    expect(getRecentPerception(fakeClient(), "nope")).toEqual([]);
    expect(getRecentPerception({}, "c1")).toEqual([]);
  });
});

describe("perceptionConfidence", () => {
  test("hedging in the image description does not downgrade the user's own words", () => {
    const message = { content: "my cat's name is Mochi" };
    const perception = "my cat's name is Mochi\na grey tabby that maybe is sleeping";
    expect(perceptionConfidence(message, perception)).toBe("high");
  });

  test("hedging in the user's own words still downgrades", () => {
    const message = { content: "lol maybe my cat is named Mochi" };
    expect(perceptionConfidence(message, "a grey tabby cat")).toBe("low");
  });

  test("perception-only extraction is low confidence", () => {
    expect(perceptionConfidence({ content: "" }, "a grey tabby cat on a couch")).toBe("low");
    expect(perceptionConfidence({ content: "   " }, "a grey tabby cat")).toBe("low");
  });

  test("plain text with no perception behaves as before", () => {
    expect(perceptionConfidence({ content: "I work as a nurse" }, null)).toBe("high");
    expect(perceptionConfidence({ content: "jk I work as a nurse" }, null)).toBe("low");
  });
});

describe("pruneDanglingToolMessages", () => {
  const assistantCall = (id) => ({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name: "x", arguments: "{}" } }] });
  const toolReply = (id) => ({ role: "tool", tool_call_id: id, content: "{}" });

  test("keeps a complete assistant/tool pair", () => {
    const history = [assistantCall("a"), toolReply("a"), { role: "assistant", content: "done" }];
    expect(pruneDanglingToolMessages(history)).toHaveLength(3);
  });

  test("drops a leading orphan tool reply whose call was trimmed away", () => {
    const history = [toolReply("a"), { role: "user", content: "hi" }];
    expect(pruneDanglingToolMessages(history)).toEqual([{ role: "user", content: "hi" }]);
  });

  test("drops an assistant tool_calls message whose replies were trimmed away", () => {
    const history = [{ role: "user", content: "hi" }, assistantCall("a")];
    expect(pruneDanglingToolMessages(history)).toEqual([{ role: "user", content: "hi" }]);
  });

  test("drops an assistant message when only some replies survive", () => {
    const multi = { role: "assistant", content: "", tool_calls: [
      { id: "a", type: "function", function: { name: "x", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "y", arguments: "{}" } },
    ] };
    const result = pruneDanglingToolMessages([multi, toolReply("a")]);
    expect(result).toEqual([]);
  });

  test("leaves ordinary history untouched", () => {
    const history = [
      { role: "user", content: "[user_1] Alice: hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "[user_1] Alice: [shared an image: a cat]" },
    ];
    expect(pruneDanglingToolMessages(history)).toEqual(history);
  });
});

describe("DIRECTIVE_KEYWORDS gate", () => {
  test.each([
    "from now on never spoil the wordle answer",
    "never tell me the answer, just hints",
    "always reply in metric units",
    "please remember to use my nickname",
    "you can now discuss spoilers again",
    "stop posting spoilers",
    "forget that rule about spoilers",
  ])("fires on a real instruction: %s", (text) => {
    expect(DIRECTIVE_KEYWORDS.test(text)).toBe(true);
  });

  test.each([
    "I always lose at slots",
    "never mind",
    "you're always so helpful",
    "I never eat breakfast",
    "she always wins these",
    "that always happens to me",
    "stop it lol",
  ])("stays quiet on ordinary chat: %s", (text) => {
    expect(DIRECTIVE_KEYWORDS.test(text)).toBe(false);
  });
});
