const {
  establishPoint,
  validateBetAllowed,
  payoutWinnings,
  resolveBets,
  BET_DEFINITIONS,
  POINT_NUMBERS,
} = require("../../utils/craps");

describe("establishPoint", () => {
  test.each(POINT_NUMBERS)("point number %i establishes a point", (n) => {
    expect(establishPoint(n)).toBe(n);
  });

  test("craps out (2) returns null", () => {
    expect(establishPoint(2)).toBeNull();
  });

  test("craps out (3) returns null", () => {
    expect(establishPoint(3)).toBeNull();
  });

  test("natural (7) returns null", () => {
    expect(establishPoint(7)).toBeNull();
  });

  test("natural (11) returns null", () => {
    expect(establishPoint(11)).toBeNull();
  });
});

describe("validateBetAllowed", () => {
  test("pass line allowed on comeout", () => {
    expect(validateBetAllowed("pass", "comeout", null, {})).toMatchObject({ allowed: true });
  });

  test("pass line not allowed after point is set", () => {
    const result = validateBetAllowed("pass", "point", 6, {});
    expect(result.allowed).toBe(false);
  });

  test("field bet allowed in both phases", () => {
    expect(validateBetAllowed("field", "comeout", null, {})).toMatchObject({ allowed: true });
    expect(validateBetAllowed("field", "point", 6, {})).toMatchObject({ allowed: true });
  });

  test("unknown bet key returns not allowed", () => {
    expect(validateBetAllowed("bogus", "comeout", null, {})).toMatchObject({ allowed: false });
  });
});

describe("payoutWinnings", () => {
  test("1:1 payout returns stake", () => {
    expect(payoutWinnings(100, { num: 1, den: 1 })).toBe(100);
  });

  test("4:1 payout (any7)", () => {
    expect(payoutWinnings(100, { num: 4, den: 1 })).toBe(400);
  });

  test("7:1 payout (anyCraps)", () => {
    expect(payoutWinnings(100, { num: 7, den: 1 })).toBe(700);
  });

  test("result is floored", () => {
    expect(payoutWinnings(100, { num: 1, den: 3 })).toBe(33);
  });
});

describe("resolveBets — comeout phase", () => {
  const passLineBet = [{ betKey: "pass", amount: 100 }];

  test("natural 7 wins pass line", () => {
    const { results } = resolveBets(passLineBet, { d1: 3, d2: 4, total: 7 }, "comeout", null);
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("win");
  });

  test("natural 11 wins pass line", () => {
    const { results } = resolveBets(passLineBet, { d1: 5, d2: 6, total: 11 }, "comeout", null);
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("win");
  });

  test("craps (2) loses pass line", () => {
    const { results } = resolveBets(passLineBet, { d1: 1, d2: 1, total: 2 }, "comeout", null);
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("lose");
  });

  test("point number establishes point, pass line stays pending", () => {
    const { results, newPhase } = resolveBets(passLineBet, { d1: 3, d2: 3, total: 6 }, "comeout", null);
    expect(newPhase).toBe("point");
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("pending");
  });
});

describe("resolveBets — point phase", () => {
  const bets = [{ betKey: "pass", amount: 100 }];

  test("hitting the point wins pass line", () => {
    const { results, newPhase } = resolveBets(bets, { d1: 3, d2: 3, total: 6 }, "point", 6);
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("win");
    expect(newPhase).toBe("comeout");
  });

  test("rolling 7 in point phase loses pass line (seven-out)", () => {
    const { results, newPhase } = resolveBets(bets, { d1: 3, d2: 4, total: 7 }, "point", 6);
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("lose");
    expect(newPhase).toBe("comeout");
  });

  test("other number in point phase leaves bets pending", () => {
    const { results, newPhase } = resolveBets(bets, { d1: 2, d2: 3, total: 5 }, "point", 6);
    const pass = results.find(r => r.betKey === "pass");
    expect(pass.status).toBe("pending");
    expect(newPhase).toBe("point");
  });
});
