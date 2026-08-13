jest.mock("../../database", () => ({
  db: { get: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const { db } = require("../../database");
const { parseBet, validateTransferAmount } = require("../../utils/betparse");

const USER_ID = "test_user";

beforeEach(() => {
  db.get.mockResolvedValue({ balance: 1000 });
});

describe("parseBet — keywords", () => {
  test("all returns full balance", async () => {
    expect(await parseBet("all", USER_ID)).toBe(1000);
  });

  test("max is an alias for all", async () => {
    expect(await parseBet("max", USER_ID)).toBe(1000);
  });

  test("half returns balance / 2", async () => {
    expect(await parseBet("half", USER_ID)).toBe(500);
  });

  test("quarter returns balance / 4", async () => {
    expect(await parseBet("quarter", USER_ID)).toBe(250);
  });

  test("eighth returns balance / 8", async () => {
    expect(await parseBet("eighth", USER_ID)).toBe(125);
  });
});

describe("parseBet — numeric literals", () => {
  test("plain integer", async () => {
    expect(await parseBet("500", USER_ID)).toBe(500);
  });

  test("zero", async () => {
    expect(await parseBet("0", USER_ID)).toBe(0);
  });

  test("whitespace around number", async () => {
    expect(await parseBet("  200  ", USER_ID)).toBe(200);
  });
});

describe("parseBet — expressions", () => {
  test("addition", async () => {
    expect(await parseBet("250+250", USER_ID)).toBe(500);
  });

  test("subtraction", async () => {
    expect(await parseBet("600-100", USER_ID)).toBe(500);
  });

  test("multiplication", async () => {
    expect(await parseBet("100*3", USER_ID)).toBe(300);
  });

  test("division", async () => {
    expect(await parseBet("1000/4", USER_ID)).toBe(250);
  });

  test("power", async () => {
    expect(await parseBet("2^10", USER_ID)).toBe(1024);
  });

  test("parentheses", async () => {
    expect(await parseBet("(100+400)*2", USER_ID)).toBe(1000);
  });

  test("all/2 equals half", async () => {
    expect(await parseBet("all/2", USER_ID)).toBe(500);
  });

  test("result is floored to integer", async () => {
    expect(await parseBet("7/2", USER_ID)).toBe(3);
  });
});

describe("parseBet — percentage syntax", () => {
  test("50% of balance", async () => {
    expect(await parseBet("all%50", USER_ID)).toBe(500);
  });

  test("25% of balance", async () => {
    expect(await parseBet("all%25", USER_ID)).toBe(250);
  });
});

describe("parseBet — invalid input", () => {
  test("non-numeric string returns NaN", async () => {
    expect(await parseBet("abc", USER_ID)).toBeNaN();
  });

  test("division by zero returns NaN", async () => {
    expect(await parseBet("100/0", USER_ID)).toBeNaN();
  });
});

describe("validateTransferAmount", () => {
  test("rejects NaN, which passes every bounds comparison and nulls balances downstream", () => {
    expect(validateTransferAmount(NaN, 1000)).toEqual({ ok: false, reason: "not_a_number" });
    expect(NaN > 1000).toBe(false);
    expect(NaN < 1).toBe(false);
  });

  test("rejects what parseBet returns for garbage input", async () => {
    for (const bad of ["abc", "ten koku", "5x", "", "100/0"]) {
      const amount = await parseBet(bad, USER_ID);
      expect(validateTransferAmount(amount, 1000).ok).toBe(false);
    }
  });

  test("rejects non-numbers and infinities", () => {
    expect(validateTransferAmount(undefined, 1000).reason).toBe("not_a_number");
    expect(validateTransferAmount(null, 1000).reason).toBe("not_a_number");
    expect(validateTransferAmount("500", 1000).reason).toBe("not_a_number");
    expect(validateTransferAmount(Infinity, 1000).reason).toBe("not_a_number");
  });

  test("rejects fractions", () => {
    expect(validateTransferAmount(10.5, 1000)).toEqual({ ok: false, reason: "not_whole" });
  });

  test("rejects zero and negatives before checking the balance", () => {
    expect(validateTransferAmount(0, 1000).reason).toBe("below_minimum");
    expect(validateTransferAmount(-50, 1000).reason).toBe("below_minimum");
  });

  test("rejects more than the balance, and treats a missing balance as zero", () => {
    expect(validateTransferAmount(1001, 1000).reason).toBe("insufficient");
    expect(validateTransferAmount(1, undefined).reason).toBe("insufficient");
    expect(validateTransferAmount(1, null).reason).toBe("insufficient");
  });

  test("accepts a whole amount within the balance, including the whole balance", () => {
    expect(validateTransferAmount(1, 1000)).toEqual({ ok: true });
    expect(validateTransferAmount(1000, 1000)).toEqual({ ok: true });
  });
});
