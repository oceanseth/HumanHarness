const { EventEmitter } = require("events");

// masky.ai voice adapter: renders crew lines as spoken audio through
// masky.ai conversations. Creates one conversation per pipeline session
// and injects speak-mode audio turns. Without a key, returns null so
// the renderer keeps using browser speechSynthesis.
//
// Each configured persona owns a separate Masky conversation so its portrait,
// personality, and voice remain distinct. Unconfigured personas keep the
// renderer's browser speechSynthesis fallback.
class Voices extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.apiKey = config.maskyApiKey;
    this.avatars = config.maskyAvatars || {};
    this.baseUrl = "https://masky.ai/api";
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.conversations = new Map();
    this.active = false;
  }

  configuredAvatars() {
    return Object.entries(this.avatars).filter(
      ([, avatar]) => avatar?.avatarId && avatar?.avatarOwnerUserId,
    );
  }

  // Start one masky.ai conversation per configured persona for this session.
  async start() {
    const configured = this.configuredAvatars();
    if (!this.apiKey || configured.length === 0) {
      this.emit("status", "masky voices: no configured persona avatars — using browser TTS fallback");
      return null;
    }

    await Promise.all(configured.map(async ([persona, avatar]) => {
      try {
        const res = await this.fetch(`${this.baseUrl}/conversations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            avatarOwnerUserId: avatar.avatarOwnerUserId,
            avatarId: avatar.avatarId,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
          const body = await res.text();
          this.emit("status", `masky ${persona} conversation failed (${res.status}): ${body}`);
          return;
        }

        const data = await res.json();
        if (!data.conversationId || !data.shareSlug) {
          this.emit("status", `masky ${persona} conversation returned incomplete data`);
          return;
        }
        this.conversations.set(persona, {
          conversationId: data.conversationId,
          shareSlug: data.shareSlug,
          liveUrl: data.liveUrl,
        });
        this.emit("status", `masky ${persona} ready: ${data.liveUrl}`);
      } catch (err) {
        this.emit("status", `masky ${persona} conversation error: ${err.message}`);
      }
    }));

    this.active = this.conversations.size > 0;
    return this.active
      ? Object.fromEntries([...this.conversations].map(([persona, value]) => [persona, value.liveUrl]))
      : null;
  }

  // Speak a line through the masky avatar voice.
  // Injects a speak-mode audio turn, then polls for the rendered audio URL.
  // Returns { audioUrl, persona } or null on failure.
  async speak(persona, line) {
    const conversation = this.conversations.get(persona);
    if (!this.active || !conversation) return null;

    try {
      // 1. Inject the turn
      const injectRes = await this.fetch(
        `${this.baseUrl}/conversations/${conversation.conversationId}/turn`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userText: line,
            output: "audio",
            mode: "speak",
          }),
        },
      );

      if (!injectRes.ok) {
        const body = await injectRes.text();
        this.emit("status", `masky turn inject failed (${injectRes.status}): ${body}`);
        return null;
      }

      const injectData = await injectRes.json();
      const turnId = injectData.turn?.id;
      if (!turnId) return null;

      // 2. Poll for the rendered audio (up to ~12s)
      const audioUrl = await this._pollForAudio(conversation, turnId, 12000, 2000);
      if (audioUrl) {
        return { audioUrl, persona };
      }
      return null;
    } catch (err) {
      this.emit("status", `masky speak error: ${err.message}`);
      return null;
    }
  }

  // Poll GET /conversations/by-slug/{shareSlug} until the target turn
  // has an audioUrl, or until timeout.
  async _pollForAudio(conversation, turnId, timeoutMs, intervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await this.fetch(
          `${this.baseUrl}/conversations/by-slug/${conversation.shareSlug}`,
          { headers: { Authorization: `Bearer ${this.apiKey}` } },
        );
        if (!res.ok) break;

        const data = await res.json();
        const turn = (data.turns || []).find((t) => t.id === turnId);
        if (turn) {
          if (turn.status === "error") {
            this.emit("status", `masky turn error: ${turn.errorMessage || "unknown"}`);
            return null;
          }
          if (turn.audioUrl) return turn.audioUrl;
        }
      } catch {
        // network hiccup — retry
      }
      await this.sleep(intervalMs);
    }
    this.emit("status", `masky turn ${turnId}: timed out waiting for audio`);
    return null;
  }

  stop() {
    this.active = false;
    this.conversations.clear();
  }
}

module.exports = { Voices };
