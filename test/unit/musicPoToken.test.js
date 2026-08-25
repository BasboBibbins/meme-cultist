// The token is the only thing standing between the bot and a 403 on every track, so the parts that
// matter are that it is reused, that a burst mints one rather than one per track, and that failing
// to mint degrades instead of throwing.

jest.mock("../../utils/logger", () => ({
  log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn(),
}));

const mockGenerateToken = jest.fn();
const mockGetInstance = jest.fn();
jest.mock("discord-player-youtubei", () => ({ generateToken: mockGenerateToken, YoutubeiExtractor: { getInstance: mockGetInstance } }), { virtual: true });

const { getPoToken, clearPoToken, TOKEN_TTL_MS } = require("../../utils/music/poToken");

beforeEach(() => {
  clearPoToken();
  mockGenerateToken.mockReset();
  mockGetInstance.mockReset().mockReturnValue({ innerTube: {} });
});

describe("getPoToken", () => {
  test("mints a token carrying the visitor data it is bound to", async () => {
    mockGenerateToken.mockResolvedValue({ poToken: "PO", visitorData: "VD" });

    const token = await getPoToken();
    expect(token.poToken).toBe("PO");
    expect(token.visitorData).toBe("VD");
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token.expiresAt).toBeLessThanOrEqual(Date.now() + TOKEN_TTL_MS);
  });

  test("reuses a live token instead of minting per track", async () => {
    mockGenerateToken.mockResolvedValue({ poToken: "PO", visitorData: "VD" });

    await getPoToken();
    await getPoToken();
    await getPoToken();
    expect(mockGenerateToken).toHaveBeenCalledTimes(1);
  });

  // A queue starting several tracks at once must not fire a generation per track.
  test("shares one in-flight generation across concurrent callers", async () => {
    let release;
    mockGenerateToken.mockReturnValue(new Promise(r => { release = () => r({ poToken: "PO", visitorData: "VD" }); }));

    const all = Promise.all([getPoToken(), getPoToken(), getPoToken()]);
    release();
    const tokens = await all;

    expect(mockGenerateToken).toHaveBeenCalledTimes(1);
    expect(tokens.every(t => t.poToken === "PO")).toBe(true);
  });

  test("resolves null rather than throwing when minting fails", async () => {
    mockGenerateToken.mockRejectedValue(new Error("botguard said no"));
    await expect(getPoToken()).resolves.toBeNull();
  });

  test("backs off after a failure instead of retrying per track", async () => {
    mockGenerateToken.mockRejectedValue(new Error("botguard said no"));

    await getPoToken();
    await getPoToken();
    await getPoToken();
    expect(mockGenerateToken).toHaveBeenCalledTimes(1);
  });

  test("degrades when the extractor has not registered yet", async () => {
    mockGetInstance.mockReturnValue(undefined);
    await expect(getPoToken()).resolves.toBeNull();
    expect(mockGenerateToken).not.toHaveBeenCalled();
  });

  test("treats an empty token as a failure rather than passing it to yt-dlp", async () => {
    mockGenerateToken.mockResolvedValue({ poToken: "", visitorData: "VD" });
    await expect(getPoToken()).resolves.toBeNull();
  });
});
