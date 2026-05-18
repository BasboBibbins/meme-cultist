// OpenAI tool handler edge-case coverage for lookup_kb and search_history.
// Dependencies (llm.embed, kbStore, messageArchive) are mocked to avoid network/DB.

const assert = require("assert");

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

async function run() {
    const tools = require("../../utils/openai-tools");

    // --- lookup_kb ---
    await testAsync("lookup_kb: missing query", async () => {
        const result = await tools.executeToolCall(
            { function: { name: "lookup_kb", arguments: "{}" } },
            { guild: { id: "g1" } },
            {}
        );
        assert.ok(result.error.includes("Missing required"));
    });

    await testAsync("lookup_kb: no guild returns error", async () => {
        const result = await tools.executeToolCall(
            { function: { name: "lookup_kb", arguments: '{"query":"rules"}' } },
            {}, // no guild
            {}
        );
        assert.ok(result.error.includes("only available in servers"));
    });

    await testAsync("lookup_kb: no results", async () => {
        const originalEmbed = require("../../utils/llm/adapters/cloudflare").embedText;
        const originalSearch = require("../../utils/kb").search;
        try {
            require("../../utils/llm/adapters/cloudflare").embedText = async () => ({ embedding: new Float32Array([1, 0, 0]) });
            require("../../utils/kb").search = () => [];
            const result = await tools.executeToolCall(
                { function: { name: "lookup_kb", arguments: '{"query":"xyzabc"}' } },
                { guild: { id: "g1" } },
                {}
            );
            assert.deepStrictEqual(result.results, []);
            assert.ok(result.message.includes("No matching"));
        } finally {
            require("../../utils/llm/adapters/cloudflare").embedText = originalEmbed;
            require("../../utils/kb").search = originalSearch;
        }
    });

    await testAsync("lookup_kb: results returned", async () => {
        const originalEmbed = require("../../utils/llm/adapters/cloudflare").embedText;
        const originalSearch = require("../../utils/kb").search;
        try {
            require("../../utils/llm/adapters/cloudflare").embedText = async () => ({ embedding: new Float32Array([1, 0, 0]) });
            require("../../utils/kb").search = () => [
                { slug: "rules", title: "Rules", content: "Be nice." },
                { slug: "faq", title: "FAQ", content: "Questions." },
            ];
            const result = await tools.executeToolCall(
                { function: { name: "lookup_kb", arguments: '{"query":"rules"}' } },
                { guild: { id: "g1" } },
                {}
            );
            assert.strictEqual(result.results.length, 2);
            assert.strictEqual(result.results[0].slug, "rules");
            assert.ok(result.results[0].content.includes("Be nice"));
        } finally {
            require("../../utils/llm/adapters/cloudflare").embedText = originalEmbed;
            require("../../utils/kb").search = originalSearch;
        }
    });

    await testAsync("lookup_kb: content truncated to 500 chars", async () => {
        const originalEmbed = require("../../utils/llm/adapters/cloudflare").embedText;
        const originalSearch = require("../../utils/kb").search;
        try {
            require("../../utils/llm/adapters/cloudflare").embedText = async () => ({ embedding: new Float32Array([1, 0, 0]) });
            require("../../utils/kb").search = () => [
                { slug: "long", title: "Long", content: "a".repeat(1000) },
            ];
            const result = await tools.executeToolCall(
                { function: { name: "lookup_kb", arguments: '{"query":"long"}' } },
                { guild: { id: "g1" } },
                {}
            );
            assert.ok(result.results[0].content.endsWith("..."));
            assert.ok(result.results[0].content.length <= 503); // 500 + "..."
        } finally {
            require("../../utils/llm/adapters/cloudflare").embedText = originalEmbed;
            require("../../utils/kb").search = originalSearch;
        }
    });

    await testAsync("lookup_kb: embed failure handled", async () => {
        const originalEmbed = require("../../utils/llm/adapters/cloudflare").embedText;
        try {
            require("../../utils/llm/adapters/cloudflare").embedText = async () => { throw new Error("network"); };
            const result = await tools.executeToolCall(
                { function: { name: "lookup_kb", arguments: '{"query":"test"}' } },
                { guild: { id: "g1" } },
                {}
            );
            assert.ok(result.error.includes("failed"));
        } finally {
            require("../../utils/llm/adapters/cloudflare").embedText = originalEmbed;
        }
    });

    // --- search_history ---
    await testAsync("search_history: missing query", async () => {
        const result = await tools.executeToolCall(
            { function: { name: "search_history", arguments: "{}" } },
            { channelId: "c1" },
            {}
        );
        assert.ok(result.error.includes("Missing required"));
    });

    await testAsync("search_history: no FTS results", async () => {
        const originalSearchFTS = require("../../utils/messageArchive").searchFTS;
        try {
            require("../../utils/messageArchive").searchFTS = () => [];
            const result = await tools.executeToolCall(
                { function: { name: "search_history", arguments: '{"query":"xyzabc"}' } },
                { channelId: "c1" },
                {}
            );
            assert.deepStrictEqual(result.results, []);
            assert.strictEqual(result.total_matches, 0);
            assert.ok(result.note.includes("No matches"));
        } finally {
            require("../../utils/messageArchive").searchFTS = originalSearchFTS;
        }
    });

    await testAsync("search_history: FTS only (good rank, no semantic)", async () => {
        const originalSearchFTS = require("../../utils/messageArchive").searchFTS;
        const originalEmbed = require("../../utils/llm").embed;
        try {
            require("../../utils/messageArchive").searchFTS = () => [
                { id: 1, author_id: "u1", content: "pizza time", created_at: 1000, rank: 0.5 },
            ];
            require("../../utils/llm").embed = async () => { throw new Error("should not be called"); };
            const result = await tools.executeToolCall(
                { function: { name: "search_history", arguments: '{"query":"pizza"}' } },
                { channelId: "c1" },
                {}
            );
            assert.strictEqual(result.results.length, 1);
            assert.strictEqual(result.results[0].content, "pizza time");
        } finally {
            require("../../utils/messageArchive").searchFTS = originalSearchFTS;
            require("../../utils/llm").embed = originalEmbed;
        }
    });

    await testAsync("search_history: semantic re-rank when rank is poor", async () => {
        const originalSearchFTS = require("../../utils/messageArchive").searchFTS;
        const originalSearchSemantic = require("../../utils/messageArchive").searchSemantic;
        const originalEmbed = require("../../utils/llm/adapters/cloudflare").embedText;
        try {
            require("../../utils/messageArchive").searchFTS = () => [
                { id: 1, author_id: "u1", content: "pizza time", created_at: 1000, rank: 2.0 },
                { id: 2, author_id: "u1", content: "sushi time", created_at: 1000, rank: 2.1 },
            ];
            require("../../utils/llm/adapters/cloudflare").embedText = async () => ({ embedding: new Float32Array([1, 0, 0]) });
            require("../../utils/messageArchive").searchSemantic = (cid, emb, candidates, limit) => [
                { id: 2, author_id: "u1", content: "sushi time", created_at: 1000, score: 0.95 },
                { id: 1, author_id: "u1", content: "pizza time", created_at: 1000, score: 0.80 },
            ];
            const result = await tools.executeToolCall(
                { function: { name: "search_history", arguments: '{"query":"food"}' } },
                { channelId: "c1" },
                {}
            );
            assert.strictEqual(result.results.length, 2);
            assert.strictEqual(result.results[0].content, "sushi time");
        } finally {
            require("../../utils/messageArchive").searchFTS = originalSearchFTS;
            require("../../utils/messageArchive").searchSemantic = originalSearchSemantic;
            require("../../utils/llm/adapters/cloudflare").embedText = originalEmbed;
        }
    });

    await testAsync("search_history: limit clamped to 1-10", async () => {
        const originalSearchFTS = require("../../utils/messageArchive").searchFTS;
        try {
            const items = [];
            for (let i = 0; i < 20; i++) {
                items.push({ id: i, author_id: "u1", content: `msg ${i}`, created_at: 1000, rank: i });
            }
            require("../../utils/messageArchive").searchFTS = () => items;
            const result = await tools.executeToolCall(
                { function: { name: "search_history", arguments: '{"query":"msg","limit":50}' } },
                { channelId: "c1" },
                {}
            );
            assert.strictEqual(result.results.length, 10);
        } finally {
            require("../../utils/messageArchive").searchFTS = originalSearchFTS;
        }
    });

    await testAsync("search_history: limit clamped to minimum 1", async () => {
        const originalSearchFTS = require("../../utils/messageArchive").searchFTS;
        try {
            require("../../utils/messageArchive").searchFTS = () => [
                { id: 1, author_id: "u1", content: "x", created_at: 1000, rank: 0.5 },
            ];
            const result = await tools.executeToolCall(
                { function: { name: "search_history", arguments: '{"query":"x","limit":0}' } },
                { channelId: "c1" },
                {}
            );
            assert.strictEqual(result.results.length, 1);
        } finally {
            require("../../utils/messageArchive").searchFTS = originalSearchFTS;
        }
    });

    await testAsync("search_history: content truncated to 300 chars", async () => {
        const originalSearchFTS = require("../../utils/messageArchive").searchFTS;
        try {
            require("../../utils/messageArchive").searchFTS = () => [
                { id: 1, author_id: "u1", content: "a".repeat(500), created_at: 1000, rank: 0.5 },
            ];
            const result = await tools.executeToolCall(
                { function: { name: "search_history", arguments: '{"query":"a"}' } },
                { channelId: "c1" },
                {}
            );
            assert.ok(result.results[0].content.endsWith("..."));
            assert.ok(result.results[0].content.length <= 303); // 300 + "..."
        } finally {
            require("../../utils/messageArchive").searchFTS = originalSearchFTS;
        }
    });

    return { passed, failed };
}

module.exports = { run };
