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

  // --- get_game_result ---
  await testAsync("get_game_result: no channel returns error", async () => {
    const result = await tools.executeToolCall(
      { function: { name: "get_game_result", arguments: "{}" } },
      { author: { id: "u1" } }, // no channelId
      {}
    );
    assert.ok(result.error.includes("channel"));
  });

  await testAsync("get_game_result: no stored result returns note", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => null;
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: "{}" } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.ok(result.note.includes("No recent game results"));
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: returns formatted slots result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "slots",
        played_at: 1700000000000,
        result: {
          grid: [["Cherry", "Cherry", "Cherry"], ["Bell", "Wild", "Bell"], ["BAR", "BAR", "BAR"]],
          active_lines: 20,
          winning_lines: [{ line: 0, symbol: "Cherry", count: 3, payout: 500 }],
          bet_per_line: 10,
          total_cost: 200,
          total_payout: 500,
          net: 300,
          outcome: "win",
          is_jackpot: false,
          jackpot_amount: null,
          is_fullscreen: false,
          is_bonus: false,
          is_free: false,
          bonus_triggered: false,
        },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: "{}" } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.game, "slots");
      assert.strictEqual(result.net, 300);
      assert.strictEqual(result.outcome, "win");
      assert.ok(Array.isArray(result.grid));
      assert.ok(result.played_at.startsWith("<t:"));
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: game filter passed through to store", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    let capturedArgs;
    try {
      gr.getLatestGameResult = (args) => { capturedArgs = args; return null; };
      await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"poker"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(capturedArgs.game, "poker");
      assert.strictEqual(capturedArgs.channelId, "c1");
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: invalid game enum rejected by schema", async () => {
    const result = await tools.executeToolCall(
      { function: { name: "get_game_result", arguments: '{"game":"baccarat"}' } },
      { channelId: "c1", author: { id: "u1" } },
      {}
    );
    assert.strictEqual(result.error, "invalid_arguments");
  });

  await testAsync("get_game_result: returns formatted poker result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "poker",
        played_at: 1700000000000,
        result: {
          final_hand: ["Ah", "Kh", "Qh", "Jh", "Th"],
          hand_name: "Royal Flush",
          bet: 1000,
          payout: 50000,
          net: 49000,
          outcome: "win",
          is_jackpot: false,
        },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"poker"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.game, "poker");
      assert.strictEqual(result.hand_name, "Royal Flush");
      assert.strictEqual(result.net, 49000);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  // --- get_recent_game_results ---
  await testAsync("get_recent_game_results: no channel returns error", async () => {
    const result = await tools.executeToolCall(
      { function: { name: "get_recent_game_results", arguments: "{}" } },
      {}, // no channelId
      {}
    );
    assert.ok(result.error.includes("channel"));
  });

  await testAsync("get_recent_game_results: empty store returns note", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getRecentGameResults;
    try {
      gr.getRecentGameResults = () => [];
      const result = await tools.executeToolCall(
        { function: { name: "get_recent_game_results", arguments: "{}" } },
        { channelId: "c1" },
        {}
      );
      assert.ok(result.note.includes("No recent game results"));
      assert.deepStrictEqual(result.results, []);
    } finally {
      gr.getRecentGameResults = original;
    }
  });

  await testAsync("get_recent_game_results: returns formatted array", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getRecentGameResults;
    try {
      gr.getRecentGameResults = () => [
        {
          game: "blackjack",
          played_at: 1700000000000,
          result: {
            player_hands: [{ cards: ["Ah", "Ks"], value: 21, bet: 500, outcome: "blackjack", doubled: false }],
            dealer_hand: { cards: ["7h", "9c"], value: 16 },
            total_bet: 500,
            payout: 750,
            net: 250,
            outcome: "blackjack",
            dealer_blackjack: false,
          },
        },
        {
          game: "roulette",
          played_at: 1700000001000,
          result: {
            winning_number: 17,
            color: "black",
            bets: [{ type: "straight", number: 17, amount: 100, outcome: "win", payout: 3500, net: 3400 }],
            total_wagered: 100,
            total_payout: 3500,
            net: 3400,
          },
        },
      ];
      const result = await tools.executeToolCall(
        { function: { name: "get_recent_game_results", arguments: "{}" } },
        { channelId: "c1" },
        {}
      );
      assert.strictEqual(result.results.length, 2);
      assert.strictEqual(result.results[0].game, "blackjack");
      assert.strictEqual(result.results[1].game, "roulette");
      assert.strictEqual(result.results[1].winning_number, 17);
    } finally {
      gr.getRecentGameResults = original;
    }
  });

  await testAsync("get_recent_game_results: limit passed through to store", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getRecentGameResults;
    let capturedLimit;
    try {
      gr.getRecentGameResults = ({ limit }) => { capturedLimit = limit; return []; };
      await tools.executeToolCall(
        { function: { name: "get_recent_game_results", arguments: '{"limit":7}' } },
        { channelId: "c1" },
        {}
      );
      assert.strictEqual(capturedLimit, 7);
    } finally {
      gr.getRecentGameResults = original;
    }
  });

  await testAsync("get_recent_game_results: limit defaults to 5", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getRecentGameResults;
    let capturedLimit;
    try {
      gr.getRecentGameResults = ({ limit }) => { capturedLimit = limit; return []; };
      await tools.executeToolCall(
        { function: { name: "get_recent_game_results", arguments: "{}" } },
        { channelId: "c1" },
        {}
      );
      assert.strictEqual(capturedLimit, 5);
    } finally {
      gr.getRecentGameResults = original;
    }
  });

  await testAsync("get_recent_game_results: invalid game enum rejected by schema", async () => {
    const result = await tools.executeToolCall(
      { function: { name: "get_recent_game_results", arguments: '{"game":"keno"}' } },
      { channelId: "c1" },
      {}
    );
    assert.strictEqual(result.error, "invalid_arguments");
  });

  // --- get_game_result: flip ---
  await testAsync("get_game_result: returns formatted flip win result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "flip",
        played_at: 1700000000000,
        result: { bet: 500, roll: 73, outcome: "win", payout: 500, net: 500 },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"flip"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.game, "flip");
      assert.strictEqual(result.outcome, "win");
      assert.strictEqual(result.bet, 500);
      assert.strictEqual(result.roll, 73);
      assert.strictEqual(result.net, 500);
      assert.ok(result.played_at.startsWith("<t:"));
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: returns formatted flip loss result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "flip",
        played_at: 1700000000000,
        result: { bet: 200, roll: 32, outcome: "loss", payout: 0, net: -200 },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"flip"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.outcome, "loss");
      assert.strictEqual(result.net, -200);
      assert.strictEqual(result.payout, 0);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  // --- get_game_result: rob ---
  await testAsync("get_game_result: returns formatted rob success result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "rob",
        played_at: 1700000000000,
        result: { victim_id: "u2", amount: 1200, outcome: "success", net: 1200 },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"rob"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.game, "rob");
      assert.strictEqual(result.outcome, "success");
      assert.strictEqual(result.victim_id, "u2");
      assert.strictEqual(result.amount, 1200);
      assert.strictEqual(result.net, 1200);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: returns formatted rob fail result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "rob",
        played_at: 1700000000000,
        result: { victim_id: "u2", amount: 800, outcome: "fail", net: 0 },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"rob"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.outcome, "fail");
      assert.strictEqual(result.net, 0);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  // --- get_game_result: duel ---
  await testAsync("get_game_result: returns formatted duel win result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "duel",
        played_at: 1700000000000,
        result: {
          challenger_id: "u1",
          opponent_id: "u2",
          challenger_choice: "rock",
          opponent_choice: "scissors",
          bet: 1000,
          outcome: "win",
          payout: 2000,
          net: 1000,
        },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"duel"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.game, "duel");
      assert.strictEqual(result.outcome, "win");
      assert.strictEqual(result.challenger_choice, "rock");
      assert.strictEqual(result.opponent_choice, "scissors");
      assert.strictEqual(result.bet, 1000);
      assert.strictEqual(result.net, 1000);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: returns formatted duel draw result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "duel",
        played_at: 1700000000000,
        result: {
          challenger_id: "u1",
          opponent_id: "u2",
          challenger_choice: "paper",
          opponent_choice: "paper",
          bet: 500,
          outcome: "draw",
          payout: 500,
          net: 0,
        },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"duel"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.outcome, "draw");
      assert.strictEqual(result.net, 0);
      assert.strictEqual(result.challenger_choice, result.opponent_choice);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: returns formatted duel forfeit result", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => ({
        game: "duel",
        played_at: 1700000000000,
        result: {
          challenger_id: "u1",
          opponent_id: "u2",
          challenger_choice: "scissors",
          opponent_choice: null,
          bet: 750,
          outcome: "forfeit_win",
          payout: 1500,
          net: 750,
        },
      });
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"duel"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.strictEqual(result.outcome, "forfeit_win");
      assert.strictEqual(result.opponent_choice, null);
      assert.strictEqual(result.net, 750);
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  // --- get_recent_game_results: new game types ---
  await testAsync("get_recent_game_results: flip and rob appear in mixed results", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getRecentGameResults;
    try {
      gr.getRecentGameResults = () => [
        { game: "flip", played_at: 1700000000000, result: { bet: 100, roll: 88, outcome: "win", payout: 100, net: 100 } },
        { game: "rob", played_at: 1700000001000, result: { victim_id: "u2", amount: 300, outcome: "fail", net: 0 } },
      ];
      const result = await tools.executeToolCall(
        { function: { name: "get_recent_game_results", arguments: "{}" } },
        { channelId: "c1" },
        {}
      );
      assert.strictEqual(result.results.length, 2);
      assert.strictEqual(result.results[0].game, "flip");
      assert.strictEqual(result.results[0].roll, 88);
      assert.strictEqual(result.results[1].game, "rob");
      assert.strictEqual(result.results[1].outcome, "fail");
    } finally {
      gr.getRecentGameResults = original;
    }
  });

  await testAsync("get_game_result: flip enum accepted by schema", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => null;
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"flip"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.ok(!result.error || result.error !== "invalid_arguments");
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  await testAsync("get_game_result: duel enum accepted by schema", async () => {
    const gr = require("../../utils/gameResults");
    const original = gr.getLatestGameResult;
    try {
      gr.getLatestGameResult = () => null;
      const result = await tools.executeToolCall(
        { function: { name: "get_game_result", arguments: '{"game":"duel"}' } },
        { channelId: "c1", author: { id: "u1" } },
        {}
      );
      assert.ok(!result.error || result.error !== "invalid_arguments");
    } finally {
      gr.getLatestGameResult = original;
    }
  });

  return { passed, failed };
}

module.exports = { run };
