const { shouldCritique, buildCritiqueEvidence } = require("../../utils/openai");

const balanceResult = [{ tool: "get_balance", args: "{}", result: { balance: 5200, bank: 100 } }];
const searchResult = [{ tool: "web_search", args: "{}", result: { results: [] } }];

describe("shouldCritique", () => {
  test("skips a reply with no tool results at all", () => {
    expect(shouldCritique("You have 5,200 koku.", [])).toBe(false);
    expect(shouldCritique("You have 5,200 koku.", undefined)).toBe(false);
  });

  test("skips when the only tools that ran ground nothing user-specific", () => {
    expect(shouldCritique("You have 5,200 koku.", searchResult)).toBe(false);
  });

  test("fires on a grounded balance claim", () => {
    expect(shouldCritique("You have 5,200 koku.", balanceResult)).toBe(true);
  });

  test("fires when the claim noun precedes the number", () => {
    expect(shouldCritique("Your balance is sitting at 300 right now.", balanceResult)).toBe(true);
  });

  test("skips an incidental number even when a grounding tool ran", () => {
    expect(shouldCritique("My top 3 anime are all from 2011.", balanceResult)).toBe(false);
  });

  test("a bare digit alone never fires", () => {
    expect(shouldCritique("There were 4 of them.", balanceResult)).toBe(false);
  });

  test("fires on relative and absolute time claims", () => {
    const reminder = [{ tool: "set_reminder", args: "{}", result: { at: 123 } }];
    expect(shouldCritique("I'll ping you in 3 hours.", reminder)).toBe(true);
    expect(shouldCritique("I'll ping you at 14:30.", reminder)).toBe(true);
  });

  test("ignores a grounding tool that failed", () => {
    const failed = [{ tool: "get_balance", args: "{}", result: { error: "upstream down", retryable: true } }];
    expect(shouldCritique("You have 5,200 koku.", failed)).toBe(false);
  });

  test("rejects empty and non-string replies", () => {
    expect(shouldCritique("", balanceResult)).toBe(false);
    expect(shouldCritique(null, balanceResult)).toBe(false);
  });
});

describe("buildCritiqueEvidence", () => {
  test("renders only grounding tools", () => {
    const evidence = buildCritiqueEvidence([...balanceResult, ...searchResult]);
    expect(evidence).toContain("get_balance");
    expect(evidence).not.toContain("web_search");
  });

  test("is empty when nothing grounds the reply", () => {
    expect(buildCritiqueEvidence(searchResult)).toBe("");
    expect(buildCritiqueEvidence([])).toBe("");
  });

  test("truncates a large payload", () => {
    const big = [{ tool: "get_leaderboard", args: "{}", result: { rows: "x".repeat(5000) } }];
    expect(buildCritiqueEvidence(big).length).toBeLessThan(1000);
  });
});
