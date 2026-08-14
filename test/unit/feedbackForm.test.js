const {
  TYPE_LABELS, EMBED_DESCRIPTION_LIMIT, FEEDBACK_FIELDS,
  buildFeedbackModal, composeDescription, clamp, descriptionFallbackTitle,
} = require("../../utils/feedbackForm");

describe("feedback modal", () => {
  test.each(Object.keys(FEEDBACK_FIELDS))("%s builds a valid modal", type => {
    const json = buildFeedbackModal(type, `feedback:${type}`).toJSON();
    expect(json.custom_id).toBe(`feedback:${type}`);
    expect(json.title).toBe(TYPE_LABELS[type]);
    // Discord allows at most 5 action rows, each holding one text input.
    expect(json.components.length).toBeGreaterThan(0);
    expect(json.components.length).toBeLessThanOrEqual(5);
    for (const row of json.components) {
      expect(row.components).toHaveLength(1);
      expect(row.components[0].style).toBe(2); // Paragraph
    }
  });

  test("every type's fields fit inside the embed description limit", () => {
    for (const [type, specs] of Object.entries(FEEDBACK_FIELDS)) {
      const values = {};
      for (const spec of specs) values[spec.id] = "x".repeat(spec.max);
      expect(composeDescription(type, values).length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
    }
  });

  test("each type has exactly one required field", () => {
    for (const specs of Object.values(FEEDBACK_FIELDS)) {
      expect(specs.filter(s => s.required)).toHaveLength(1);
      expect(specs[0].required).toBe(true);
    }
  });
});

describe("composeDescription", () => {
  test("single-field type renders as plain prose with no label", () => {
    expect(composeDescription("general", { what: "the bot is great" })).toBe("the bot is great");
  });

  test("multi-field type labels each answer", () => {
    const out = composeDescription("bug", { what: "slots broke", expected: "a payout", repro: "bet all" });
    expect(out).toBe("**What happened?**\nslots broke\n\n**What did you expect instead?**\na payout\n\n**How do we make it happen again?**\nbet all");
  });

  test("omits blank and whitespace-only optional fields", () => {
    const out = composeDescription("bug", { what: "slots broke", expected: "   ", repro: "" });
    expect(out).toBe("**What happened?**\nslots broke");
  });

  test("trims surrounding whitespace from values", () => {
    expect(composeDescription("general", { what: "  padded  " })).toBe("padded");
  });

  test("missing keys do not throw", () => {
    expect(composeDescription("bug", {})).toBe("");
  });
});

describe("clamp", () => {
  test("returns text untouched when within the limit", () => {
    expect(clamp("short", 10)).toBe("short");
  });

  test("never exceeds the limit, ellipsis included", () => {
    const out = clamp("x".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("passes through empty and nullish input", () => {
    expect(clamp("", 10)).toBe("");
    expect(clamp(null, 10)).toBeNull();
    expect(clamp(undefined, 10)).toBeUndefined();
  });
});

describe("descriptionFallbackTitle", () => {
  test("takes the first sentence", () => {
    expect(descriptionFallbackTitle("Slots pays wrong. It happens on all-in.")).toBe("Slots pays wrong");
  });

  test("skips a leading empty segment instead of returning a blank title", () => {
    expect(descriptionFallbackTitle("...crashes on load")).toBe("crashes on load");
    expect(descriptionFallbackTitle("!!!")).not.toBe("");
  });

  test("cuts long text on a word boundary", () => {
    const out = descriptionFallbackTitle("word ".repeat(40), 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wo…$/);
  });

  test("does not leave a bare label when the text opens with punctuation", () => {
    expect(descriptionFallbackTitle("? ? ? something real").trim().length).toBeGreaterThan(0);
  });
});
