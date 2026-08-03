const { EventEmitter } = require("events");

// masky.ai voice adapter: renders crew lines as spoken audio through
// masky.ai conversations. Creates one conversation per pipeline session
// and injects speak-mode audio turns. Without a key, returns null so
// the renderer keeps using browser speechSynthesis.
//
// Requires MASKY_AVATAR_ID and MASKY_AVATAR_OWNER_USER_ID in env for the
// avatar whose voice will speak every line. The avatar must already exist
// (create one at https://masky.ai/developer or via the API).
class Voices extends EventEmitter {
  constructor(config) {
    super();
    this.apiKey = config.maskyApiKey;
    this.avatarId = config.maskyAvatarId;
    this.avatarOwnerUserId = config.maskyAvatarOwnerUserId;
    this.baseUrl = "https://masky.ai/api";

    this.conversationId = null;
    this.shareSlug = null;
    this.liveUrl = null;
    this.active = false;
  }

  // Start a masky.ai conversation for this session. One conversation
  // hosts all commentary turns; each turn auto-appends to the live player.
  async start() {
    if (!this.apiKey || !this.avatarId || !this.avatarOwnerUserId) {
      this.emit("status", "masky voices: missing key / avatarId / avatarOwnerUserId — using browser TTS fallback");
      return null;
    }

    try {
      const res = await fetch(`${this.baseUrl}/conversations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          avatarOwnerUserId: this.avatarOwnerUserId,
          avatarId: this.avatarId,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.emit("status", `masky conversation create failed (${res.status}): ${body}`);
        return null;
      }

      const data = await res.json();
      this.conversationId = data.conversationId;
      this.shareSlug = data.shareSlug;
      this.liveUrl = data.liveUrl;
      this.active = true;

      this.emit("status", `masky conversation ready: ${this.liveUrl}`);
      return this.liveUrl;
    } catch (err) {
      this.emit("status", `masky conversation error: ${err.message}`);
      return null;
    }
  }

  // Speak a line through the masky avatar voice.
  // Injects a speak-mode audio turn, then polls for the rendered audio URL.
  // Returns { audioUrl, persona } or null on failure.
  async speak(persona, line) {
    if (!this.active || !this.conversationId) return null;

    try {
      // 1. Inject the turn
      const injectRes = await fetch(
        `${this.baseUrl}/conversations/${this.conversationId}/turn`,
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
      const audioUrl = await this._pollForAudio(turnId, 6000, 2000);
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
  async _pollForAudio(turnId, timeoutMs, intervalMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(
          `${this.baseUrl}/conversations/by-slug/${this.shareSlug}`,
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
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    this.emit("status", `masky turn ${turnId}: timed out waiting for audio`);
    return null;
  }

  stop() {
    this.active = false;
    this.conversationId = null;
    this.shareSlug = null;
    this.liveUrl = null;
  }
}

module.exports = { Voices };
