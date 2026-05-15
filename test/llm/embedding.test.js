// Embedding adapter and router edge-case coverage. Tests Cloudflare embedText
// and the router's embed() wrapper using mocked fetch.

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

function withDummyCreds(fn) {
    const config = require("../../config.js");
    const savedAccount = config.CF_ACCOUNT_ID;
    const savedKey = config.CF_API_KEY;
    config.CF_ACCOUNT_ID = "test-account";
    config.CF_API_KEY = "test-key";
    try {
        return fn();
    } finally {
        config.CF_ACCOUNT_ID = savedAccount;
        config.CF_API_KEY = savedKey;
    }
}

async function withDummyCredsAsync(fn) {
    const config = require("../../config.js");
    const savedAccount = config.CF_ACCOUNT_ID;
    const savedKey = config.CF_API_KEY;
    config.CF_ACCOUNT_ID = "test-account";
    config.CF_API_KEY = "test-key";
    try {
        return await fn();
    } finally {
        config.CF_ACCOUNT_ID = savedAccount;
        config.CF_API_KEY = savedKey;
    }
}

async function run() {
    // --- Cloudflare adapter: embedText ---
    await testAsync("embedText: happy path (mocked)", async () => {
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const originalFetch = global.fetch;
        try {
            global.fetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ result: { data: [[0.1, 0.2, 0.3, 0.4]] } }),
            });
            await withDummyCredsAsync(async () => {
                const res = await adapter.embedText({ text: "hello" });
                assert.ok(res.embedding instanceof Float32Array);
                assert.strictEqual(res.embedding.length, 4);
                assert.ok(Math.abs(res.embedding[0] - 0.1) < 0.0001);
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    await testAsync("embedText: missing credentials throws", async () => {
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const config = require("../../config.js");
        const savedAccount = config.CF_ACCOUNT_ID;
        const savedKey = config.CF_API_KEY;
        try {
            config.CF_ACCOUNT_ID = "";
            config.CF_API_KEY = "";
            await assert.rejects(
                async () => await adapter.embedText({ text: "hello" }),
                /CF_ACCOUNT_ID or CF_API_KEY is not set/
            );
        } finally {
            config.CF_ACCOUNT_ID = savedAccount;
            config.CF_API_KEY = savedKey;
        }
    });

    await testAsync("embedText: API error throws", async () => {
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const originalFetch = global.fetch;
        try {
            global.fetch = async () => ({
                ok: false,
                status: 500,
                json: async () => ({ errors: [{ message: "AiError: rate limited" }] }),
            });
            await withDummyCredsAsync(async () => {
                await assert.rejects(
                    async () => await adapter.embedText({ text: "hello" }),
                    /Cloudflare embed failed/
                );
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    await testAsync("embedText: missing embedding in response throws", async () => {
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const originalFetch = global.fetch;
        try {
            global.fetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({ result: { data: [] } }),
            });
            await withDummyCredsAsync(async () => {
                await assert.rejects(
                    async () => await adapter.embedText({ text: "hello" }),
                    /Cloudflare returned no embedding data/
                );
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    // --- Router: embed() ---
    await testAsync("router embed: wraps adapter with timeout", async () => {
        const router = require("../../utils/llm/router");
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const originalEmbed = adapter.embedText;
        try {
            adapter.embedText = async () => ({
                embedding: new Float32Array([1, 2, 3]),
            });
            const res = await router.embed({ text: "test", timeoutMs: 5000, retries: 1 });
            assert.ok(res.embedding instanceof Float32Array);
            assert.ok(res.latency_ms >= 0);
        } finally {
            adapter.embedText = originalEmbed;
        }
    });

    await testAsync("router embed: retries on failure", async () => {
        const router = require("../../utils/llm/router");
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const originalEmbed = adapter.embedText;
        let calls = 0;
        try {
            adapter.embedText = async () => {
                calls++;
                if (calls < 2) throw new Error("network timeout");
                return { embedding: new Float32Array([1, 2, 3]) };
            };
            const res = await router.embed({ text: "test", timeoutMs: 5000, retries: 2 });
            assert.strictEqual(calls, 2);
            assert.ok(res.embedding);
        } finally {
            adapter.embedText = originalEmbed;
        }
    });

    await testAsync("router embed: exhausts retries and throws", async () => {
        const router = require("../../utils/llm/router");
        const adapter = require("../../utils/llm/adapters/cloudflare");
        const originalEmbed = adapter.embedText;
        try {
            adapter.embedText = async () => {
                throw new Error("persistent");
            };
            await assert.rejects(
                async () => await router.embed({ text: "test", timeoutMs: 5000, retries: 1 }),
                /persistent/
            );
        } finally {
            adapter.embedText = originalEmbed;
        }
    });

    // --- LLM index re-export ---
    test("llm index re-exports embed", () => {
        const llm = require("../../utils/llm");
        assert.strictEqual(typeof llm.embed, "function");
    });

    return { passed, failed };
}

module.exports = { run };
