// KB store edge-case coverage: CRUD, embeddings, cosine similarity, search ranking,
// and concurrency guards.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TEST_DB = path.resolve(process.cwd(), `db/kb_test_${Date.now()}.sqlite`);
process.env.KB_TEST_DB = TEST_DB;

const kbStore = require("../../utils/kb/store");

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

function cleanDb() {
  kbStore.close();
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch (_) {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch (_) {}
  try { fs.unlinkSync(TEST_DB); } catch (_) {}
}

function makeEmbedding(values) {
  return new Float32Array(values);
}

async function run() {
  cleanDb();

  // --- create ---
  await testAsync("create: happy path", async () => {
    const entry = await kbStore.create({
      guildId: "g1",
      slug: "rules",
      title: "Server Rules",
      content: "Be nice.",
      tags: "meta,rules",
      creatorId: "u1",
    });
    assert.strictEqual(entry.slug, "rules");
    assert.strictEqual(entry.title, "Server Rules");
    assert.strictEqual(entry.content, "Be nice.");
    assert.strictEqual(entry.tags, "meta,rules");
    assert.strictEqual(entry.creatorId, "u1");
    assert.strictEqual(entry.guildId, "g1");
    assert.ok(entry.id > 0);
    assert.ok(entry.createdAt > 0);
  });

  await testAsync("create: missing required fields throws", async () => {
    await assert.rejects(
      async () => await kbStore.create({ guildId: "g1", slug: "x" }),
      /required/
    );
  });

  await testAsync("create: duplicate slug in same guild throws", async () => {
    await kbStore.create({ guildId: "g1", slug: "dup", title: "A", content: "B", creatorId: "u1" });
    await assert.rejects(
      async () => await kbStore.create({ guildId: "g1", slug: "dup", title: "A2", content: "B2", creatorId: "u1" }),
      /UNIQUE constraint failed/
    );
  });

  await testAsync("create: same slug in different guilds is allowed", async () => {
    const e1 = await kbStore.create({ guildId: "g1", slug: "shared", title: "A", content: "B", creatorId: "u1" });
    const e2 = await kbStore.create({ guildId: "g2", slug: "shared", title: "C", content: "D", creatorId: "u2" });
    assert.strictEqual(e1.guildId, "g1");
    assert.strictEqual(e2.guildId, "g2");
  });

  // --- getBySlug / getById ---
  test("getBySlug: found", () => {
    const entry = kbStore.getBySlug("g1", "rules");
    assert.ok(entry);
    assert.strictEqual(entry.slug, "rules");
  });

  test("getBySlug: not found", () => {
    const entry = kbStore.getBySlug("g1", "nonexistent");
    assert.strictEqual(entry, null);
  });

  test("getById: found", () => {
    const bySlug = kbStore.getBySlug("g1", "rules");
    const byId = kbStore.getById(bySlug.id);
    assert.ok(byId);
    assert.strictEqual(byId.slug, "rules");
  });

  test("getById: not found", () => {
    const entry = kbStore.getById(99999);
    assert.strictEqual(entry, null);
  });

  // --- listForGuild ---
  test("listForGuild: returns entries ordered by title", () => {
    const list = kbStore.listForGuild("g1");
    assert.ok(list.length >= 2);
    assert.ok(list[0].title <= list[1].title);
  });

  test("listForGuild: empty guild", () => {
    const list = kbStore.listForGuild("gx");
    assert.deepStrictEqual(list, []);
  });

  // --- update ---
  await testAsync("update: happy path", async () => {
    const updated = await kbStore.update({ guildId: "g1", slug: "rules", title: "Updated Rules", content: "Be very nice." });
    assert.strictEqual(updated.title, "Updated Rules");
    assert.strictEqual(updated.content, "Be very nice.");
  });

  await testAsync("update: partial (title only)", async () => {
    const before = kbStore.getBySlug("g1", "rules");
    const updated = await kbStore.update({ guildId: "g1", slug: "rules", title: "Rules v2" });
    assert.strictEqual(updated.title, "Rules v2");
    assert.strictEqual(updated.content, before.content);
  });

  await testAsync("update: clears embedding", async () => {
    kbStore.setEmbedding("g1", "rules", makeEmbedding([1, 0, 0]));
    let e = kbStore.getBySlug("g1", "rules");
    assert.ok(e.embedding);
    await kbStore.update({ guildId: "g1", slug: "rules", title: "Rules v3" });
    e = kbStore.getBySlug("g1", "rules");
    assert.strictEqual(e.embedding, null);
  });

  await testAsync("update: missing entry returns null", async () => {
    const updated = await kbStore.update({ guildId: "g1", slug: "ghost", title: "X" });
    assert.strictEqual(updated, null);
  });

  // --- deleteBySlug ---
  await testAsync("deleteBySlug: removes entry", async () => {
    await kbStore.create({ guildId: "g1", slug: "tmp", title: "T", content: "C", creatorId: "u1" });
    assert.ok(kbStore.getBySlug("g1", "tmp"));
    const ok = kbStore.deleteBySlug("g1", "tmp");
    assert.strictEqual(ok, true);
    assert.strictEqual(kbStore.getBySlug("g1", "tmp"), null);
  });

  test("deleteBySlug: missing entry returns false", () => {
    const ok = kbStore.deleteBySlug("g1", "ghost");
    assert.strictEqual(ok, false);
  });

  // --- setEmbedding ---
  await testAsync("setEmbedding: accepts Float32Array", async () => {
    await kbStore.create({ guildId: "g1", slug: "emb1", title: "E", content: "C", creatorId: "u1" });
    const ok = kbStore.setEmbedding("g1", "emb1", makeEmbedding([1, 2, 3]));
    assert.strictEqual(ok, true);
    const e = kbStore.getBySlug("g1", "emb1");
    assert.ok(e.embedding);
  });

  test("setEmbedding: accepts plain Array", () => {
    const ok = kbStore.setEmbedding("g1", "emb1", [0.5, 0.5, 0.5]);
    assert.strictEqual(ok, true);
  });

  test("setEmbedding: accepts Buffer", () => {
    const buf = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    const ok = kbStore.setEmbedding("g1", "emb1", buf);
    assert.strictEqual(ok, true);
  });

  test("setEmbedding: rejects invalid type", () => {
    assert.throws(
      () => kbStore.setEmbedding("g1", "emb1", "not-an-embedding"),
      /must be Float32Array, Array, or Buffer/
    );
  });

  test("setEmbedding: missing entry returns false", () => {
    const ok = kbStore.setEmbedding("g1", "ghost", makeEmbedding([1, 2, 3]));
    assert.strictEqual(ok, false);
  });

  // --- search ---
  await testAsync("search: no embeddings returns empty", async () => {
    await kbStore.create({ guildId: "g-empty", slug: "no-emb", title: "No Emb", content: "Text", creatorId: "u1" });
    const results = kbStore.search("g-empty", makeEmbedding([1, 0, 0]), 3);
    assert.deepStrictEqual(results, []);
  });

  test("search: single match", () => {
    kbStore.setEmbedding("g1", "emb1", makeEmbedding([1, 0, 0]));
    const results = kbStore.search("g1", makeEmbedding([1, 0, 0]), 3);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].slug, "emb1");
    assert.ok(results[0].score > 0.99);
  });

  await testAsync("search: multiple sorted by score", async () => {
    await kbStore.create({ guildId: "g1", slug: "close", title: "Close", content: "C", creatorId: "u1" });
    kbStore.setEmbedding("g1", "close", makeEmbedding([0.9, 0.1, 0]));
    await kbStore.create({ guildId: "g1", slug: "far", title: "Far", content: "C", creatorId: "u1" });
    kbStore.setEmbedding("g1", "far", makeEmbedding([0, 0, 1]));

    const results = kbStore.search("g1", makeEmbedding([1, 0, 0]), 3);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].slug, "emb1");
    assert.strictEqual(results[1].slug, "close");
    assert.strictEqual(results[2].slug, "far");
    assert.ok(results[0].score > results[1].score);
    assert.ok(results[1].score > results[2].score);
  });

  test("search: respects limit", () => {
    const results = kbStore.search("g1", makeEmbedding([1, 0, 0]), 1);
    assert.strictEqual(results.length, 1);
  });

  test("search: accepts Array instead of Float32Array", () => {
    const results = kbStore.search("g1", [1, 0, 0], 1);
    assert.strictEqual(results.length, 1);
  });

  await testAsync("search: dimension mismatch is skipped", async () => {
    await kbStore.create({ guildId: "g1", slug: "dim2", title: "D2", content: "C", creatorId: "u1" });
    kbStore.setEmbedding("g1", "dim2", makeEmbedding([1, 0]));
    const results = kbStore.search("g1", makeEmbedding([1, 0, 0]), 10);
    const found = results.find(r => r.slug === "dim2");
    assert.strictEqual(found, undefined);
  });

  // --- concurrency / lock ---
  await testAsync("concurrency: simultaneous creates do not corrupt", async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        kbStore.create({ guildId: "g1", slug: `concurrent-${i}`, title: `T${i}`, content: `C${i}`, creatorId: "u1" })
          .catch(() => null)
      );
    }
    const results = await Promise.all(promises);
    const successes = results.filter(Boolean);
    assert.strictEqual(successes.length, 10);
  });

  // --- cleanup ---
  cleanDb();

  return { passed, failed };
}

module.exports = { run };
