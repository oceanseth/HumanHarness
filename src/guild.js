const DEFAULT_BASE_URL = "https://app.guild.ai";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanBaseUrl = (value) => String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");

const parseJsonText = (value) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const normalizeGuildOutput = (value) => {
  let candidate = parseJsonText(value);
  if (candidate && candidate.output !== undefined) candidate = parseJsonText(candidate.output);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Guild returned an invalid routing result");
  }

  const persona = String(candidate.persona || "");
  if (!persona) throw new Error("Guild routing result is missing persona");

  return {
    persona,
    routingReason: candidate.rationale ? String(candidate.rationale) : "",
  };
};

const eventText = (event) => {
  if (event?.type !== "agent_notification_message") return null;
  const content = event.content;
  if (typeof content === "string") return content;
  if (content?.type === "text") return content.data;
  return null;
};

const eventError = (event) => {
  if (!event || typeof event !== "object") return null;
  if (event.type === "runtime_error") return event.content || "Guild agent failed";
  if (event.type === "system_error" || event.type === "agent_notification_error") {
    return event.content?.data || event.content || "Guild agent failed";
  }
  return null;
};

class GuildClient {
  constructor(config = {}, options = {}) {
    this.apiKey = config.apiKey || "";
    this.owner = config.owner || "";
    this.workspace = config.workspace || "";
    this.baseUrl = cleanBaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs ?? 60000;
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.fetch = options.fetch || globalThis.fetch;
    this.sleep = options.sleep || delay;
  }

  configurationError() {
    if (!this.apiKey) return "GUILD_API_KEY is not configured";
    const separator = this.apiKey.indexOf(":");
    if (separator <= 0 || separator === this.apiKey.length - 1) {
      return "GUILD_API_KEY must be the API trigger credentials string <api_key_id>:<api_key_secret>";
    }
    if (!this.owner) return "GUILD_WORKSPACE_OWNER is not configured";
    if (!this.workspace) return "GUILD_WORKSPACE is not configured";
    if (typeof this.fetch !== "function") return "This Node.js runtime does not provide fetch";
    return null;
  }

  isConfigured() {
    return this.configurationError() === null;
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${Buffer.from(this.apiKey).toString("base64")}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.detail || payload?.message || response.statusText || "request failed";
      throw new Error(`Guild request failed (${response.status}): ${detail}`);
    }
    return payload;
  }

  async route(agentInput) {
    const configError = this.configurationError();
    if (configError) throw new Error(configError);

    const owner = encodeURIComponent(this.owner);
    const workspace = encodeURIComponent(this.workspace);
    const session = await this.request(`/api/workspaces/${owner}/${workspace}/sessions`, {
      method: "POST",
      body: JSON.stringify({ session_type: "api_trigger", agent_input: agentInput }),
    });
    if (!session?.id) throw new Error("Guild did not return a session id");
    return this.waitForResult(session.id);
  }

  async waitForResult(sessionId) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.timeoutMs) {
      const query = new URLSearchParams({ limit: "1000" });
      const payload = await this.request(
        `/api/sessions/${encodeURIComponent(sessionId)}/events?${query}`,
      );
      const events = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

      for (const event of events) {
        const failure = eventError(event);
        if (failure) throw new Error(`Guild agent failed: ${failure}`);

        if (event.type === "runtime_done" && event.content !== undefined) {
          return normalizeGuildOutput(event.content);
        }

        const text = eventText(event);
        if (text) {
          const parsed = parseJsonText(text);
          if (parsed) return normalizeGuildOutput(parsed);
        }
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new Error(`Guild agent timed out after ${this.timeoutMs}ms`);
  }
}

module.exports = { GuildClient, normalizeGuildOutput };
