// Schema validation edge-case coverage for parseAndValidate + chatWithSchema.

const assert = require("assert");
const { parseAndValidate, chatWithSchema } = require("../../utils/schemas");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

function run() {
  // --- parseAndValidate: fact-extraction ---
  test("fact-extraction: happy path", () => {
    const r = parseAndValidate("fact-extraction", '{"facts":[{"key":"job","value":"nurse","confidence":"high"}]}');
    assert.strictEqual(r.error, null);
    assert.deepStrictEqual(r.data.facts, [{ key: "job", value: "nurse", confidence: "high" }]);
  });

  test("fact-extraction: missing required field (key)", () => {
    const r = parseAndValidate("fact-extraction", '{"facts":[{"value":"no-key"}]}');
    assert.ok(r.error);
    assert.ok(r.error.includes("key"), `Expected error to mention 'key', got: ${r.error}`);
  });

  test("fact-extraction: extra properties rejected", () => {
    const r = parseAndValidate("fact-extraction", '{"facts":[{"key":"a","value":"b","foo":"bar"}]}');
    assert.ok(r.error);
    assert.ok(r.error.includes("additionalProperties") || r.error.includes("additional"), `Expected additionalProperties error, got: ${r.error}`);
  });

  test("fact-extraction: confidence enum enforcement", () => {
    const r = parseAndValidate("fact-extraction", '{"facts":[{"key":"a","value":"b","confidence":"medium"}]}');
    assert.ok(r.error);
    assert.ok(r.error.includes("confidence"), `Expected confidence enum error, got: ${r.error}`);
  });

  test("fact-extraction: empty facts array", () => {
    const r = parseAndValidate("fact-extraction", '{"facts":[]}');
    assert.strictEqual(r.error, null);
    assert.deepStrictEqual(r.data.facts, []);
  });

  test("fact-extraction: strips markdown fences", () => {
    const r = parseAndValidate("fact-extraction", "```json\n{\"facts\":[{\"key\":\"a\",\"value\":\"b\"}]}\n```");
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data.facts.length, 1);
  });

  test("fact-extraction: strips plain fences", () => {
    const r = parseAndValidate("fact-extraction", "```\n{\"facts\":[{\"key\":\"a\",\"value\":\"b\"}]}\n```");
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data.facts.length, 1);
  });

  test("fact-extraction: invalid JSON", () => {
    const r = parseAndValidate("fact-extraction", "not json");
    assert.ok(r.error);
    assert.ok(r.error.includes("JSON parse error"), `Expected JSON parse error, got: ${r.error}`);
  });

  // --- parseAndValidate: compress-facts ---
  test("compress-facts: happy path", () => {
    const r = parseAndValidate("compress-facts", '{"facts":[{"key":"x","value":"y"}]}');
    assert.strictEqual(r.error, null);
  });

  test("compress-facts: missing facts array", () => {
    const r = parseAndValidate("compress-facts", "{}");
    assert.ok(r.error);
    assert.ok(r.error.includes("facts"), `Expected facts required error, got: ${r.error}`);
  });

  // --- parseAndValidate: critique ---
  test("critique: ok true", () => {
    const r = parseAndValidate("critique", '{"ok":true}');
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data.ok, true);
  });

  test("critique: ok false with fix", () => {
    const r = parseAndValidate("critique", '{"ok":false,"fix":"bad number"}');
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.data.fix, "bad number");
  });

  test("critique: missing ok", () => {
    const r = parseAndValidate("critique", '{"fix":"missing ok"}');
    assert.ok(r.error);
    assert.ok(r.error.includes("ok"), `Expected ok required error, got: ${r.error}`);
  });

  test("critique: ok is not boolean", () => {
    const r = parseAndValidate("critique", '{"ok":"yes"}');
    assert.ok(r.error);
  });

  // --- parseAndValidate: feedback-validation ---
  test("feedback-validation: happy path", () => {
    const r = parseAndValidate("feedback-validation", '{"valid":true,"reason":"ok","category":"legitimate"}');
    assert.strictEqual(r.error, null);
  });

  test("feedback-validation: category enum violation", () => {
    const r = parseAndValidate("feedback-validation", '{"valid":true,"reason":"ok","category":"invalid"}');
    assert.ok(r.error);
    assert.ok(r.error.includes("category"), `Expected category enum error, got: ${r.error}`);
  });

  test("feedback-validation: missing reason", () => {
    const r = parseAndValidate("feedback-validation", '{"valid":true,"category":"legitimate"}');
    assert.ok(r.error);
    assert.ok(r.error.includes("reason"), `Expected reason required error, got: ${r.error}`);
  });

  // --- chatWithSchema mocking ---
  testAsync("chatWithSchema: first attempt success", async () => {
    const original = require("../../utils/llm");
    let callCount = 0;
    const restore = original.chat;
    original.chat = async () => {
      callCount++;
      return {
        result: { content: '{"facts":[{"key":"a","value":"b"}]}' },
        usage: {},
      };
    };
    try {
      const res = await chatWithSchema({
        schemaName: "fact-extraction",
        model: "deepseek-chat",
        messages: [{ role: "user", content: "test" }],
      });
      assert.strictEqual(callCount, 1, "Expected exactly one LLM call");
      assert.deepStrictEqual(res.validated.facts, [{ key: "a", value: "b" }]);
    } finally {
      original.chat = restore;
    }
  });

  testAsync("chatWithSchema: retry on first failure, success on second", async () => {
    const original = require("../../utils/llm");
    let callCount = 0;
    const restore = original.chat;
    original.chat = async () => {
      callCount++;
      if (callCount === 1) {
        return { result: { content: "not json" }, usage: {} };
      }
      return {
        result: { content: '{"facts":[{"key":"a","value":"b"}]}' },
        usage: {},
      };
    };
    try {
      const res = await chatWithSchema({
        schemaName: "fact-extraction",
        model: "deepseek-chat",
        messages: [{ role: "user", content: "test" }],
      });
      assert.strictEqual(callCount, 2, "Expected two LLM calls (retry)");
      assert.deepStrictEqual(res.validated.facts, [{ key: "a", value: "b" }]);
    } finally {
      original.chat = restore;
    }
  });

  testAsync("chatWithSchema: double failure returns schemaError + raw", async () => {
    const original = require("../../utils/llm");
    let callCount = 0;
    const restore = original.chat;
    original.chat = async () => {
      callCount++;
      return { result: { content: "still bad" }, usage: {} };
    };
    try {
      const res = await chatWithSchema({
        schemaName: "fact-extraction",
        model: "deepseek-chat",
        messages: [{ role: "user", content: "test" }],
      });
      assert.strictEqual(callCount, 2, "Expected two LLM calls");
      assert.strictEqual(res.validated, null);
      assert.ok(res.schemaError, "Expected schemaError on double failure");
      assert.strictEqual(res.raw, "still bad");
    } finally {
      original.chat = restore;
    }
  });

  return { passed, failed };
}

module.exports = { run };
