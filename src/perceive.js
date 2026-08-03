const Anthropic = require("@anthropic-ai/sdk");

const LABEL_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      scene: { type: "string", description: "One-line description of the scene" },
      objects: { type: "array", items: { type: "string" } },
      events: {
        type: "array",
        items: { type: "string" },
        description: "Things happening right now that a co-caster would react to",
      },
    },
    required: ["scene", "objects", "events"],
    additionalProperties: false,
  },
};

// Vision labeler: frame JPEG -> {scene, objects, events} via Claude.
class Perceiver {
  constructor(config) {
    this.config = config;
    this.client = new Anthropic();
    this.busy = false;
  }

  // Returns labels or null (if a request is already in flight, or on error).
  async label(frameJpeg) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const response = await this.client.messages.create({
        model: this.config.visionModel,
        max_tokens: 1024,
        output_config: { format: LABEL_SCHEMA },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: frameJpeg.toString("base64"),
                },
              },
              {
                type: "text",
                text: "Label this live-stream frame for a real-time commentary crew. Scene, visible objects, and events happening right now.",
              },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal") return null;
      const text = response.content.find((b) => b.type === "text");
      return text ? { ...JSON.parse(text.text), ts: new Date().toISOString() } : null;
    } catch (err) {
      return { error: err.message };
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Perceiver };
