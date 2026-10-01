jest.mock("../../config.js", () => ({ CHATBOT_CHANNELS: ["sfw", "nsfw-a", "nsfw-b"] }));

const { isNsfwChannel, findNsfwChatbotChannel } = require("../../utils/channels");

const clientWith = (channels) => ({ channels: { cache: new Map(channels.map(c => [c.id, c])) } });

describe("isNsfwChannel", () => {
  test("reads the channel's own age-restricted flag", () => {
    expect(isNsfwChannel({ nsfw: true })).toBe(true);
    expect(isNsfwChannel({ nsfw: false })).toBe(false);
  });

  test("a thread inherits its parent's flag", () => {
    expect(isNsfwChannel({ nsfw: false, parent: { nsfw: true } })).toBe(true);
  });

  test("a missing channel is not NSFW", () => {
    expect(isNsfwChannel(null)).toBe(false);
  });
});

describe("findNsfwChatbotChannel", () => {
  test("returns the first age-restricted chatbot channel in config order", () => {
    const client = clientWith([{ id: "sfw", nsfw: false }, { id: "nsfw-b", nsfw: true }, { id: "nsfw-a", nsfw: true }]);
    expect(findNsfwChatbotChannel(client).id).toBe("nsfw-a");
  });

  test("ignores age-restricted channels that are not chatbot channels", () => {
    const client = clientWith([{ id: "sfw", nsfw: false }, { id: "elsewhere", nsfw: true }]);
    expect(findNsfwChatbotChannel(client)).toBeNull();
  });

  test("returns null when a configured channel is not cached", () => {
    expect(findNsfwChatbotChannel(clientWith([]))).toBeNull();
    expect(findNsfwChatbotChannel(undefined)).toBeNull();
  });
});
