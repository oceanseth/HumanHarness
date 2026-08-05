const { MiniMaxClient, parseJsonResponse } = require("./minimax");

// Vision labeler: frame JPEG -> {scene, objects, events} via MiniMax's
// coding-plan image-understanding endpoint.
class Perceiver {
  constructor(config) {
    this.config = config;
    this.client = new MiniMaxClient(config.minimax);
    this.busy = false;
  }

  // Returns labels or null (if a request is already in flight, or on error).
  async label(frameJpeg) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const text = await this.client.understandImage(
        frameJpeg,
        [
          "Label this live-stream frame for a real-time commentary crew.",
          "Return JSON only with exactly these fields:",
          '{"scene":"one-line description","objects":["visible object"],"events":["event happening now"]}',
          "Do not include markdown or commentary outside the JSON object.",
        ].join(" "),
      );
      const labels = parseJsonResponse(text);
      return {
        scene: String(labels.scene || ""),
        objects: Array.isArray(labels.objects) ? labels.objects.map(String) : [],
        events: Array.isArray(labels.events) ? labels.events.map(String) : [],
        ts: new Date().toISOString(),
      };
    } catch (err) {
      return { error: err.message };
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Perceiver };
