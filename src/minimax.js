const DEFAULT_API_HOST = "https://api.minimax.io";

const stripReasoning = (text) =>
  String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

const parseJsonResponse = (text) => {
  const cleaned = stripReasoning(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("MiniMax returned no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
};

class MiniMaxClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || "";
    this.apiHost = (config.apiHost || DEFAULT_API_HOST).replace(/\/+$/, "");
  }

  async request(path, body) {
    if (!this.apiKey) throw new Error("MINIMAX_KEY is not configured");

    const response = await fetch(`${this.apiHost}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "MM-API-Source": "HumanHarness",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.base_resp?.status_msg || payload?.error?.message || response.statusText;
      throw new Error(`MiniMax request failed (${response.status}): ${detail}`);
    }
    if (payload?.base_resp?.status_code && payload.base_resp.status_code !== 0) {
      throw new Error(`MiniMax API error: ${payload.base_resp.status_msg || payload.base_resp.status_code}`);
    }
    return payload;
  }

  async chat({ model, system, user, maxTokens = 1024 }) {
    const payload = await this.request("/v1/chat/completions", {
      model,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: user },
      ],
      max_completion_tokens: maxTokens,
    });
    return stripReasoning(payload?.choices?.[0]?.message?.content);
  }

  async understandImage(frameJpeg, prompt) {
    const payload = await this.request("/v1/coding_plan/vlm", {
      prompt,
      image_url: `data:image/jpeg;base64,${frameJpeg.toString("base64")}`,
    });
    if (!payload?.content) throw new Error("MiniMax vision returned no content");
    return payload.content;
  }
}

module.exports = { MiniMaxClient, parseJsonResponse, stripReasoning };
