const {
  calculateWinnings,
  validateBet,
  getRedBlack,
} = require("../../utils/roulette");

describe("getRedBlack", () => {
  test("0 is green", () => {
    expect(getRedBlack(0)).toBe("green");
  });

  test("1 is red", () => {
    expect(getRedBlack(1)).toBe("red");
  });

  test("2 is black", () => {
    expect(getRedBlack(2)).toBe("black");
  });

  test("32 is red", () => {
    expect(getRedBlack(32)).toBe("red");
  });

  test("33 is black", () => {
    expect(getRedBlack(33)).toBe("black");
  });
});

describe("validateBet", () => {
  test("valid bet types are allowed", () => {
    for (const type of ["straight", "red", "black", "even", "odd", "low", "high",
      "dozen1", "dozen2", "dozen3", "column1", "column2", "column3"]) {
      const result = validateBet(type, type === "straight" ? 17 : undefined);
      expect(result.allowed).toBe(true);
    }
  });

  test("straight bet requires a valid number 0–36", () => {
    expect(validateBet("straight", 0).allowed).toBe(true);
    expect(validateBet("straight", 36).allowed).toBe(true);
    expect(validateBet("straight", -1).allowed).toBe(false);
    expect(validateBet("straight", 37).allowed).toBe(false);
    expect(validateBet("straight", 1.5).allowed).toBe(false);
  });

  test("unknown bet type is rejected", () => {
    expect(validateBet("bogus", null).allowed).toBe(false);
  });
});

describe("calculateWinnings", () => {
  test("straight bet pays 35:1 on exact number", () => {
    expect(calculateWinnings("straight", 17, 100, 17)).toBe(3500);
  });

  test("straight bet loses on wrong number", () => {
    expect(calculateWinnings("straight", 17, 100, 18)).toBe(0);
  });

  test("red bet pays 2:1 on red number", () => {
    expect(calculateWinnings("red", null, 100, 1)).toBe(200);
  });

  test("red bet loses on black number", () => {
    expect(calculateWinnings("red", null, 100, 2)).toBe(0);
  });

  test("red and black both lose on 0", () => {
    expect(calculateWinnings("red", null, 100, 0)).toBe(0);
    expect(calculateWinnings("black", null, 100, 0)).toBe(0);
  });

  test("even bet pays 2:1 on even number", () => {
    expect(calculateWinnings("even", null, 100, 4)).toBe(200);
  });

  test("even bet loses on odd number", () => {
    expect(calculateWinnings("even", null, 100, 3)).toBe(0);
  });

  test("odd bet pays 2:1 on odd number", () => {
    expect(calculateWinnings("odd", null, 100, 3)).toBe(200);
  });

  test("low (1–18) pays 2:1", () => {
    expect(calculateWinnings("low", null, 100, 18)).toBe(200);
    expect(calculateWinnings("low", null, 100, 19)).toBe(0);
  });

  test("high (19–36) pays 2:1", () => {
    expect(calculateWinnings("high", null, 100, 19)).toBe(200);
    expect(calculateWinnings("high", null, 100, 18)).toBe(0);
  });

  test("dozen1 (1–12) pays 3:1", () => {
    expect(calculateWinnings("dozen1", null, 100, 12)).toBe(300);
    expect(calculateWinnings("dozen1", null, 100, 13)).toBe(0);
  });

  test("dozen2 (13–24) pays 3:1", () => {
    expect(calculateWinnings("dozen2", null, 100, 13)).toBe(300);
  });

  test("dozen3 (25–36) pays 3:1", () => {
    expect(calculateWinnings("dozen3", null, 100, 36)).toBe(300);
  });

  test("column1 pays 3:1 for numbers 1,4,7,...", () => {
    expect(calculateWinnings("column1", null, 100, 1)).toBe(300);
    expect(calculateWinnings("column1", null, 100, 4)).toBe(300);
    expect(calculateWinnings("column1", null, 100, 2)).toBe(0);
  });
});
