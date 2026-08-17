const { ComponentType } = require("discord.js");
const {
  TYPE_LABELS, DEFAULT_TYPE, EMBED_DESCRIPTION_LIMIT, TYPE_FIELD, SCREENSHOT_FIELD,
  FEEDBACK_TYPES, FEEDBACK_FIELDS, buildFeedbackModal,
  readFeedbackType, readFeedbackValues, readScreenshotUrl,
  composeDescription, clamp, descriptionFallbackTitle,
} = require("../../utils/feedbackForm");

// Minimal stand-in for ModalSubmitInteraction#fields — mirrors the real
// getters' return shapes: radio yields a string, uploads yield a Collection.
function fakeSubmit({ kind, text = {}, files = null }) {
  return {
    fields: {
      getRadioGroup: id => (id === TYPE_FIELD ? kind : undefined),
      getTextInputValue: id => text[id] ?? "",
      getUploadedFiles: id => (id === SCREENSHOT_FIELD ? files : null),
    },
  };
}

describe("feedback modal", () => {
  const json = buildFeedbackModal("feedback:123").toJSON();

  test("fits Discord's five top-level component budget", () => {
    expect(json.components.length).toBeLessThanOrEqual(5);
  });

  test("leads with the public-issue disclosure", () => {
    expect(json.components[0].type).toBe(ComponentType.TextDisplay);
    expect(json.components[0].content).toMatch(/public GitHub issue/i);
  });

  test("every input is wrapped in a Label, never an Action Row", () => {
    for (const component of json.components.slice(1)) {
      expect(component.type).toBe(ComponentType.Label);
      expect(component.label.length).toBeLessThanOrEqual(100);
      if (component.description) expect(component.description.length).toBeLessThanOrEqual(300);
    }
    expect(json.components.some(c => c.type === ComponentType.ActionRow)).toBe(false);
  });

  test("collects kind, prose, and an optional screenshot", () => {
    const children = json.components.slice(1).map(c => c.component);
    const byId = Object.fromEntries(children.map(c => [c.custom_id, c]));

    expect(byId[TYPE_FIELD].type).toBe(ComponentType.RadioGroup);
    expect(byId[TYPE_FIELD].required).toBe(true);
    expect(byId[TYPE_FIELD].options.map(o => o.value)).toEqual(Object.keys(TYPE_LABELS));

    expect(byId.what.type).toBe(ComponentType.TextInput);
    expect(byId.what.required).toBe(true);
    expect(byId.extra.required).toBe(false);

    expect(byId[SCREENSHOT_FIELD].type).toBe(ComponentType.FileUpload);
    expect(byId[SCREENSHOT_FIELD].required).toBe(false);
  });

  test("every radio option maps to a known feedback type", () => {
    for (const option of FEEDBACK_TYPES) {
      expect(TYPE_LABELS).toHaveProperty(option.value);
    }
  });

  test("exactly one prose field is required", () => {
    expect(FEEDBACK_FIELDS.filter(f => f.required)).toHaveLength(1);
    expect(FEEDBACK_FIELDS[0].required).toBe(true);
  });

  test("a completely filled form still fits the embed description limit", () => {
    const values = {};
    for (const spec of FEEDBACK_FIELDS) values[spec.id] = "x".repeat(spec.max);
    expect(composeDescription(values).length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
  });
});

describe("reading a submission", () => {
  test("reads the selected kind", () => {
    expect(readFeedbackType(fakeSubmit({ kind: "bug" }))).toBe("bug");
    expect(readFeedbackType(fakeSubmit({ kind: "suggestion" }))).toBe("suggestion");
  });

  test("an unknown or missing kind falls back instead of leaking through", () => {
    expect(readFeedbackType(fakeSubmit({ kind: "haxx" }))).toBe(DEFAULT_TYPE);
    expect(readFeedbackType(fakeSubmit({ kind: null }))).toBe(DEFAULT_TYPE);
    expect(readFeedbackType(fakeSubmit({ kind: "toString" }))).toBe(DEFAULT_TYPE);
  });

  test("reads every prose field, defaulting blanks to empty", () => {
    const values = readFeedbackValues(fakeSubmit({ kind: "bug", text: { what: "it broke" } }));
    expect(values.what).toBe("it broke");
    expect(values.extra).toBe("");
  });

  test("screenshot is null when nothing was uploaded", () => {
    expect(readScreenshotUrl(fakeSubmit({ kind: "bug" }))).toBeNull();
    expect(readScreenshotUrl(fakeSubmit({ kind: "bug", files: { first: () => undefined } }))).toBeNull();
  });

  test("screenshot returns the first upload's url", () => {
    const files = { first: () => ({ url: "https://cdn.discordapp.com/a.png" }) };
    expect(readScreenshotUrl(fakeSubmit({ kind: "bug", files }))).toBe("https://cdn.discordapp.com/a.png");
  });
});

describe("composeDescription", () => {
  test("the lead answer renders as plain prose with no label", () => {
    expect(composeDescription({ what: "slots pays wrong" })).toBe("slots pays wrong");
  });

  test("a filled second box is labelled", () => {
    expect(composeDescription({ what: "slots pays wrong", extra: "bet all first" }))
      .toBe("slots pays wrong\n\n**Anything else worth knowing?**\nbet all first");
  });

  test("omits blank and whitespace-only fields", () => {
    expect(composeDescription({ what: "slots pays wrong", extra: "   " })).toBe("slots pays wrong");
  });

  test("trims values and tolerates missing keys", () => {
    expect(composeDescription({ what: "  padded  " })).toBe("padded");
    expect(composeDescription({})).toBe("");
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
});
