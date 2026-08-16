// Message archive store edge-case coverage: insert dedup, FTS5 search,
// semantic re-rank, embedding formats, and count tracking.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Kept out of `db/`, because a swallowed unlink there leaves orphans beside the live databases.
const TEST_DB = path.join(os.tmpdir(), `message_archive_test_${Date.now()}.sqlite`);
process.env.ARCHIVE_TEST_DB = TEST_DB;

const archive = require("../../utils/messageArchive/store");

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
  archive.close();
  try { fs.unlinkSync(TEST_DB + "-wal"); } catch (_) {}
  try { fs.unlinkSync(TEST_DB + "-shm"); } catch (_) {}
  try { fs.unlinkSync(TEST_DB); } catch (_) {}
}

function makeEmbedding(values) {
  return new Float32Array(values);
}

async function run() {
  cleanDb();

  // --- insertChunk ---
  test("insertChunk: happy path", () => {
    const id = archive.insertChunk({
      channelId: "c1",
      messageId: "m1",
      authorId: "u1",
      content: "hello world",
      chunkIndex: 0,
      createdAt: Date.now(),
    });
    assert.ok(id > 0);
  });

  test("insertChunk: dedup by message_id + chunk_index", () => {
    const id1 = archive.insertChunk({
      channelId: "c1", messageId: "m2", authorId: "u1", content: "first",
      chunkIndex: 0, createdAt: Date.now(),
    });
    const id2 = archive.insertChunk({
      channelId: "c1", messageId: "m2", authorId: "u1", content: "second",
      chunkIndex: 0, createdAt: Date.now(),
    });
    assert.ok(id1 > 0);
    assert.strictEqual(id2, null);
  });

  test("insertChunk: same message_id different chunk_index is allowed", () => {
    const id1 = archive.insertChunk({
      channelId: "c1", messageId: "m3", authorId: "u1", content: "chunk 0",
      chunkIndex: 0, createdAt: Date.now(),
    });
    const id2 = archive.insertChunk({
      channelId: "c1", messageId: "m3", authorId: "u1", content: "chunk 1",
      chunkIndex: 1, createdAt: Date.now(),
    });
    assert.ok(id1 > 0);
    assert.ok(id2 > 0);
    assert.notStrictEqual(id1, id2);
  });

  test("insertChunk: empty content is allowed", () => {
    const id = archive.insertChunk({
      channelId: "c1", messageId: "m-empty", authorId: "u1", content: "",
      chunkIndex: 0, createdAt: Date.now(),
    });
    assert.ok(id > 0);
  });

  // --- countForChannel ---
  test("countForChannel: empty channel", () => {
    assert.strictEqual(archive.countForChannel("cx"), 0);
  });

  test("countForChannel: counts inserted chunks", () => {
    const before = archive.countForChannel("c1");
    archive.insertChunk({ channelId: "c1", messageId: "m-count", authorId: "u1", content: "x", chunkIndex: 0, createdAt: Date.now() });
    const after = archive.countForChannel("c1");
    assert.strictEqual(after, before + 1);
  });

  // --- getMaxMessageIdForChannel ---
  test("getMaxMessageIdForChannel: empty", () => {
    assert.strictEqual(archive.getMaxMessageIdForChannel("cx"), null);
  });

  test("getMaxMessageIdForChannel: returns highest message_id", () => {
    archive.insertChunk({ channelId: "c2", messageId: "100", authorId: "u1", content: "a", chunkIndex: 0, createdAt: Date.now() });
    archive.insertChunk({ channelId: "c2", messageId: "200", authorId: "u1", content: "b", chunkIndex: 0, createdAt: Date.now() });
    archive.insertChunk({ channelId: "c2", messageId: "150", authorId: "u1", content: "c", chunkIndex: 0, createdAt: Date.now() });
    const maxId = archive.getMaxMessageIdForChannel("c2");
    assert.strictEqual(maxId, "200");
  });

  // --- setEmbedding ---
  test("setEmbedding: accepts Float32Array", () => {
    const freshId = archive.insertChunk({ channelId: "c1", messageId: "m-emb2", authorId: "u1", content: "test2", chunkIndex: 0, createdAt: Date.now() });
    const ok = archive.setEmbedding(freshId, makeEmbedding([1, 0, 0]));
    assert.strictEqual(ok, true);
  });

  test("setEmbedding: accepts plain Array", () => {
    const id = archive.insertChunk({ channelId: "c1", messageId: "m-emb3", authorId: "u1", content: "t", chunkIndex: 0, createdAt: Date.now() });
    const ok = archive.setEmbedding(id, [0.5, 0.5, 0.5]);
    assert.strictEqual(ok, true);
  });

  test("setEmbedding: accepts Buffer", () => {
    const id = archive.insertChunk({ channelId: "c1", messageId: "m-emb4", authorId: "u1", content: "t", chunkIndex: 0, createdAt: Date.now() });
    const buf = Buffer.from(new Float32Array([0.1, 0.2, 0.3]).buffer);
    const ok = archive.setEmbedding(id, buf);
    assert.strictEqual(ok, true);
  });

  test("setEmbedding: rejects invalid type", () => {
    const id = archive.insertChunk({ channelId: "c1", messageId: "m-emb5", authorId: "u1", content: "t", chunkIndex: 0, createdAt: Date.now() });
    assert.throws(
      () => archive.setEmbedding(id, "bad"),
      /must be Float32Array, Array, or Buffer/
    );
  });

  test("setEmbedding: missing id returns false", () => {
    const ok = archive.setEmbedding(99999, makeEmbedding([1, 0, 0]));
    assert.strictEqual(ok, false);
  });

  // --- searchFTS ---
  test("searchFTS: no results", () => {
    const results = archive.searchFTS("c1", "xyzabc");
    assert.deepStrictEqual(results, []);
  });

  test("searchFTS: single match", () => {
    archive.insertChunk({ channelId: "c3", messageId: "m-fts1", authorId: "u1", content: "pizza is great", chunkIndex: 0, createdAt: Date.now() });
    const results = archive.searchFTS("c3", "pizza");
    assert.strictEqual(results.length, 1);
    assert.ok(results[0].content.includes("pizza"));
  });

  test("searchFTS: multiple matches ranked", () => {
    archive.insertChunk({ channelId: "c3", messageId: "m-fts2", authorId: "u1", content: "i love pizza", chunkIndex: 0, createdAt: Date.now() });
    archive.insertChunk({ channelId: "c3", messageId: "m-fts3", authorId: "u1", content: "pizza pizza pizza", chunkIndex: 0, createdAt: Date.now() });
    archive.insertChunk({ channelId: "c3", messageId: "m-fts4", authorId: "u1", content: "burgers are ok", chunkIndex: 0, createdAt: Date.now() });
    const results = archive.searchFTS("c3", "pizza", 10);
    assert.ok(results.length >= 2);
    for (const r of results) {
      assert.ok(r.content.includes("pizza"));
    }
  });

  test("searchFTS: scoped to channel", () => {
    archive.insertChunk({ channelId: "c4", messageId: "m-scoped", authorId: "u1", content: "unique word here", chunkIndex: 0, createdAt: Date.now() });
    const results = archive.searchFTS("c3", "unique word here");
    assert.deepStrictEqual(results, []);
  });

  test("searchFTS: respects limit", () => {
    for (let i = 0; i < 10; i++) {
      archive.insertChunk({ channelId: "c5", messageId: `m-lim-${i}`, authorId: "u1", content: `common term ${i}`, chunkIndex: 0, createdAt: Date.now() });
    }
    const results = archive.searchFTS("c5", "common", 5);
    assert.strictEqual(results.length, 5);
  });

  // --- searchSemantic ---
  test("searchSemantic: no candidates returns empty", () => {
    const results = archive.searchSemantic("c1", makeEmbedding([1, 0, 0]), []);
    assert.deepStrictEqual(results, []);
  });

  test("searchSemantic: no embeddings returns empty", () => {
    const id = archive.insertChunk({ channelId: "c6", messageId: "m-no-emb", authorId: "u1", content: "no embed", chunkIndex: 0, createdAt: Date.now() });
    const results = archive.searchSemantic("c6", makeEmbedding([1, 0, 0]), [id]);
    assert.deepStrictEqual(results, []);
  });

  test("searchSemantic: exact match highest score", () => {
    const id1 = archive.insertChunk({ channelId: "c7", messageId: "m-s1", authorId: "u1", content: "exact", chunkIndex: 0, createdAt: Date.now() });
    const id2 = archive.insertChunk({ channelId: "c7", messageId: "m-s2", authorId: "u1", content: "close", chunkIndex: 0, createdAt: Date.now() });
    archive.setEmbedding(id1, makeEmbedding([1, 0, 0]));
    archive.setEmbedding(id2, makeEmbedding([0.9, 0.1, 0]));
    const results = archive.searchSemantic("c7", makeEmbedding([1, 0, 0]), [id1, id2], 2);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].message_id, "m-s1");
    assert.ok(results[0].score > results[1].score);
  });

  test("searchSemantic: dimension mismatch skipped", () => {
    const id = archive.insertChunk({ channelId: "c8", messageId: "m-dim", authorId: "u1", content: "dim", chunkIndex: 0, createdAt: Date.now() });
    archive.setEmbedding(id, makeEmbedding([1, 0]));
    const results = archive.searchSemantic("c8", makeEmbedding([1, 0, 0]), [id]);
    assert.deepStrictEqual(results, []);
  });

  test("searchSemantic: respects limit", () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = archive.insertChunk({ channelId: "c9", messageId: `m-sem-${i}`, authorId: "u1", content: `x${i}`, chunkIndex: 0, createdAt: Date.now() });
      archive.setEmbedding(id, makeEmbedding([i * 0.1, 1 - i * 0.1, 0]));
      ids.push(id);
    }
    const results = archive.searchSemantic("c9", makeEmbedding([0, 1, 0]), ids, 2);
    assert.strictEqual(results.length, 2);
  });

  // --- getUnembeddedForChannel ---
  test("getUnembeddedForChannel: returns only unembedded", () => {
    archive.insertChunk({ channelId: "c-unemb", messageId: "m-unemb", authorId: "u1", content: "not embedded", chunkIndex: 0, createdAt: Date.now() });
    const before = archive.getUnembeddedForChannel("c-unemb", 100);
    const hasUnembedded = before.some(r => r.id);
    assert.ok(hasUnembedded);
  });

  test("getUnembeddedForChannel: empty after embedding all", () => {
    const unemb = archive.getUnembeddedForChannel("c9", 100);
    for (const r of unemb) {
      archive.setEmbedding(r.id, makeEmbedding([0, 0, 0]));
    }
    const after = archive.getUnembeddedForChannel("c9", 100);
    assert.deepStrictEqual(after, []);
  });

  // --- cleanup ---
  cleanDb();

  return { passed, failed };
}

module.exports = { run };
