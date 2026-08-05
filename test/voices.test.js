const assert = require("node:assert/strict");
const test = require("node:test");
const { Voices } = require("../src/voices");

const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

test("Voices renders only the persona with a configured Masky avatar", async () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/conversations") && options.method === "POST") {
      return response({
        conversationId: "historian-conversation",
        shareSlug: "historian-slug",
        liveUrl: "https://masky.ai/live/historian",
      });
    }
    if (url.endsWith("/historian-conversation/turn")) {
      return response({ turn: { id: "historian-turn" } }, 202);
    }
    if (url.endsWith("/by-slug/historian-slug")) {
      return response({ turns: [{ id: "historian-turn", audioUrl: "https://audio.test/history.mp3" }] });
    }
    throw new Error(`unexpected Masky URL: ${url}`);
  };
  const voices = new Voices({
    maskyApiKey: "masky-key",
    maskyAvatars: {
      strategist: { avatarId: "", avatarOwnerUserId: "" },
      historian: { avatarId: "historian-avatar", avatarOwnerUserId: "twitch:historian" },
      hypecaster: { avatarId: "", avatarOwnerUserId: "" },
      scout: { avatarId: "", avatarOwnerUserId: "" },
    },
  }, { fetch, sleep: async () => {} });

  const live = await voices.start();
  assert.deepEqual(live, { historian: "https://masky.ai/live/historian" });
  assert.deepEqual(
    JSON.parse(calls[0].options.body),
    { avatarOwnerUserId: "twitch:historian", avatarId: "historian-avatar" },
  );
  assert.deepEqual(
    await voices.speak("historian", "The old pattern returns."),
    { audioUrl: "https://audio.test/history.mp3", persona: "historian" },
  );
  assert.equal(await voices.speak("scout", "Look ahead."), null);

  voices.stop();
  assert.equal(voices.active, false);
  assert.equal(voices.conversations.size, 0);
});

