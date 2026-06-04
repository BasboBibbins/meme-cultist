const {
  applyParticipantUpdate,
  resolveSubjectId,
  mergeFacts,
  buildMultiUserFactsBlock,
  buildParticipantsBlock,
} = require("../../utils/openai");

const DAY = 24 * 60 * 60 * 1000;

describe("applyParticipantUpdate", () => {
  test("registers a new participant", () => {
    const { participants, renames } = applyParticipantUpdate({}, [{ userId: "1", displayName: "Alice" }], 1000);
    expect(participants["1"]).toEqual({ currentName: "Alice", namesSeen: ["Alice"], firstSeen: 1000, lastSeen: 1000 });
    expect(renames).toEqual([]);
  });

  test("records a rename and appends to namesSeen", () => {
    const start = applyParticipantUpdate({}, [{ userId: "1", displayName: "Alice" }], 1000).participants;
    const { participants, renames } = applyParticipantUpdate(start, [{ userId: "1", displayName: "Alicia" }], 2000);
    expect(participants["1"].currentName).toBe("Alicia");
    expect(participants["1"].namesSeen).toEqual(["Alice", "Alicia"]);
    expect(participants["1"].firstSeen).toBe(1000);
    expect(participants["1"].lastSeen).toBe(2000);
    expect(renames).toEqual([{ userId: "1", oldName: "Alice", newName: "Alicia" }]);
  });

  test("no rename when the name is unchanged", () => {
    const start = applyParticipantUpdate({}, [{ userId: "1", displayName: "Alice" }], 1000).participants;
    const { renames } = applyParticipantUpdate(start, [{ userId: "1", displayName: "Alice" }], 2000);
    expect(renames).toEqual([]);
  });

  test("prunes participants idle beyond the 30-day TTL", () => {
    const start = applyParticipantUpdate({}, [{ userId: "1", displayName: "Alice" }], 1000).participants;
    const now = 1000 + 31 * DAY;
    const { participants } = applyParticipantUpdate(start, [{ userId: "2", displayName: "Bob" }], now);
    expect(participants["1"]).toBeUndefined();
    expect(participants["2"]).toBeDefined();
  });

  test("does not mutate the input map", () => {
    const original = {};
    applyParticipantUpdate(original, [{ userId: "1", displayName: "Alice" }], 1000);
    expect(original).toEqual({});
  });
});

describe("resolveSubjectId", () => {
  const participants = {
    "456": { currentName: "Bobby", namesSeen: ["Bob", "Bobby"] },
  };
  const guildMembers = new Map([
    ["789", { displayName: "Carol" }],
  ]);

  test("maps self/empty to the author", () => {
    expect(resolveSubjectId("self", "123", "Alice", participants, guildMembers)).toBe("123");
    expect(resolveSubjectId("", "123", "Alice", participants, guildMembers)).toBe("123");
    expect(resolveSubjectId(undefined, "123", "Alice", participants, guildMembers)).toBe("123");
  });

  test("maps the author's own name to the author", () => {
    expect(resolveSubjectId("alice", "123", "Alice", participants, guildMembers)).toBe("123");
  });

  test("resolves a former display name via the participant registry", () => {
    expect(resolveSubjectId("Bob", "123", "Alice", participants, guildMembers)).toBe("456");
  });

  test("resolves a name via the guild member cache", () => {
    expect(resolveSubjectId("carol", "123", "Alice", participants, guildMembers)).toBe("789");
  });

  test("falls back to the author for an unknown name", () => {
    expect(resolveSubjectId("Zoidberg", "123", "Alice", participants, guildMembers)).toBe("123");
  });
});

describe("mergeFacts subject attribution", () => {
  test("stamps subjectUserId from defaultSubjectId", () => {
    const facts = mergeFacts([], [{ key: "job", value: "nurse" }], "", "userA");
    expect(facts).toHaveLength(1);
    expect(facts[0].subjectUserId).toBe("userA");
  });

  test("same key for different subjects coexists", () => {
    let facts = mergeFacts([], [{ key: "favorite_food", value: "ramen" }], "", "userA");
    facts = mergeFacts(facts, [{ key: "favorite_food", value: "sushi" }], "", "userB");
    expect(facts).toHaveLength(2);
    const bySubject = Object.fromEntries(facts.map(f => [f.subjectUserId, f.value]));
    expect(bySubject).toEqual({ userA: "ramen", userB: "sushi" });
  });

  test("same key + same subject updates in place", () => {
    let facts = mergeFacts([], [{ key: "job", value: "nurse" }], "", "userA");
    facts = mergeFacts(facts, [{ key: "job", value: "doctor" }], "", "userA");
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe("doctor");
  });

  test("retraction only removes the matching subject's fact", () => {
    let facts = mergeFacts([], [{ key: "sport", value: "tennis" }], "", "userA");
    facts = mergeFacts(facts, [{ key: "sport", value: "golf" }], "", "userB");
    facts = mergeFacts(facts, [{ key: "sport", value: "__deleted__" }], "", "userA");
    expect(facts).toHaveLength(1);
    expect(facts[0].subjectUserId).toBe("userB");
    expect(facts[0].value).toBe("golf");
  });

  test("per-fact subjectUserId overrides the default", () => {
    const facts = mergeFacts([], [{ key: "allergy", value: "peanuts", subjectUserId: "userB" }], "", "userA");
    expect(facts[0].subjectUserId).toBe("userB");
  });
});

describe("buildMultiUserFactsBlock", () => {
  const nameOf = uid => ({ A: "Alice", B: "Bob" })[uid];
  const perUser = {
    A: [{ key: "favorite_food", value: "ramen", confidence: "high" }],
    B: [{ key: "favorite_food", value: "sushi", confidence: "high" }],
  };

  test("emits one id-anchored block per participant, speaker first", () => {
    const block = buildMultiUserFactsBlock("A", ["A", "B"], perUser, nameOf);
    expect(block).toContain('UserFacts name="Alice" id="A"');
    expect(block).toContain('UserFacts name="Bob" id="B"');
    expect(block.indexOf("Alice")).toBeLessThan(block.indexOf("Bob"));
  });

  test("skips participants with no facts", () => {
    const block = buildMultiUserFactsBlock("A", ["A", "B"], { A: perUser.A }, nameOf);
    expect(block).toContain('id="A"');
    expect(block).not.toContain('id="B"');
  });
});

describe("buildParticipantsBlock", () => {
  test("lists present users with id anchors and aka aliases", () => {
    const participants = {
      "1": { currentName: "Alicia", namesSeen: ["Alice", "Alicia"] },
      "2": { currentName: "Bob", namesSeen: ["Bob"] },
    };
    const block = buildParticipantsBlock(participants, ["1", "2"]);
    expect(block).toContain("[Participants]");
    expect(block).toContain("Alicia (user_1) (aka Alice): present");
    expect(block).toContain("Bob (user_2): present");
  });

  test("returns empty string when no present users are known", () => {
    expect(buildParticipantsBlock({}, ["99"])).toBe("");
  });
});

describe("legacy fact migration semantics", () => {
  // Mirrors the getUserChatbotData / migrateUserFactSubjects backfill: a legacy
  // fact with no subjectUserId is stamped with the store owner's id BEFORE it
  // reaches mergeFacts, so a later same-key update dedups instead of duplicating.
  const backfill = (facts, ownerId) =>
    facts.map(f => (f && !f.subjectUserId) ? { ...f, subjectUserId: ownerId } : f);

  test("backfilled legacy fact updates in place instead of duplicating", () => {
    const legacy = [{ key: "job", value: "nurse" }];
    const merged = mergeFacts(backfill(legacy, "U"), [{ key: "job", value: "doctor" }], "", "U");
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe("doctor");
    expect(merged[0].subjectUserId).toBe("U");
  });

  test("without backfill the same merge would duplicate (documents the bug)", () => {
    const legacy = [{ key: "job", value: "nurse" }]; // no subjectUserId
    const merged = mergeFacts(legacy, [{ key: "job", value: "doctor" }], "", "U");
    expect(merged).toHaveLength(2); // exactly what the migration prevents
  });

  test("backfill is idempotent for already-attributed facts", () => {
    const facts = [{ key: "job", value: "nurse", subjectUserId: "V" }];
    expect(backfill(facts, "U")[0].subjectUserId).toBe("V");
  });
});
