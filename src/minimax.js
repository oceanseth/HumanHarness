const MINI_MAX_CHAT_URL = "https://api.minimax.chat/v1/text/chatcompletion_v2";

class MiniMaxClient {
  constructor({ apiKey, groupId }) {
    this.apiKey = apiKey;
    this.groupId = groupId;
  }

  async createChatCompletion(body) {
    if (!this.apiKey) throw new Error("MINIMAX_API_KEY is not configured");

    const url = new URL(MINI_MAX_CHAT_URL);
    if (this.groupId) url.searchParams.set("GroupId", this.groupId);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.base_resp?.status_code) {
      throw new Error(payload.base_resp?.status_msg || payload.error?.message || `MiniMax request failed (${response.status})`);
    }
    return payload;
  }
}

const responseText = (response) => response.choices?.[0]?.message?.content || null;

module.exports = { MiniMaxClient, responseText };
