const { MiniMaxClient, responseText } = require("./minimax");

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

// Vision labeler: frame JPEG -> {scene, objects, events} via MiniMax.
class Perceiver {
  constructor(config) {
    this.config = config;
    this.client = new MiniMaxClient({
      apiKey: config.minimaxApiKey,
      groupId: config.minimaxGroupId,
    });
    this.busy = false;
  }

  // Returns labels or null (if a request is already in flight, or on error).
  async label(frameJpeg) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const response = await this.client.createChatCompletion({
        model: this.config.visionModel,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${frameJpeg.toString("base64")}` },
              },
              {
                type: "text",
                text: "Label this live-stream frame for a real-time commentary crew. Scene, visible objects, and events happening right now. Return only JSON matching this schema: " + JSON.stringify(LABEL_SCHEMA.schema),
              },
            ],
          },
        ],
      });
      const text = responseText(response);
      return text ? { ...JSON.parse(text), ts: new Date().toISOString() } : null;
    } catch (err) {
      return { error: err.message };
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Perceiver };
