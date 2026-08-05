const DEFAULT_BASE_URL = "https://app.guild.ai";
const GUILD_PERSONAS = new Set(["strategist", "historian", "hypecaster", "scout"]);
const GUILD_PRIORITIES = new Set(["low", "normal", "high"]);

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

const unwrapGuildOutput = (value) => {
  let candidate = parseJsonText(value);
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) break;
    if (candidate.output === undefined) break;
    candidate = parseJsonText(candidate.output);
  }
  return candidate;
};

const normalizeSpecialistBrief = (value, persona) => {
  const brief = parseJsonText(value);
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
    throw new Error("Guild specialist returned an invalid brief");
  }

  const briefPersona = String(brief.persona || "");
  if (briefPersona !== persona) {
    throw new Error("Guild specialist brief does not match the routed persona");
  }

  const priority = brief.priority;
  if (typeof priority !== "string" || !GUILD_PRIORITIES.has(priority)) {
    throw new Error("Guild specialist brief has an invalid priority");
  }
  if (
    typeof brief.decision !== "string" ||
    typeof brief.summary !== "string" ||
    !Array.isArray(brief.evidence) ||
    !brief.evidence.every((item) => typeof item === "string") ||
    !Array.isArray(brief.directives) ||
    !brief.directives.every((item) => typeof item === "string") ||
    (brief.lookup !== null && brief.lookup !== undefined && typeof brief.lookup !== "string")
  ) {
    throw new Error("Guild specialist brief has invalid structured fields");
  }

  return {
    persona: briefPersona,
    decision: brief.decision,
    priority,
    summary: brief.summary,
    evidence: brief.evidence,
    directives: brief.directives,
    lookup: brief.lookup ?? null,
  };
};

const normalizeGuildOutput = (value) => {
  const candidate = unwrapGuildOutput(value);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Guild returned an invalid routing result");
  }

  const persona = String(candidate.persona || "");
  if (!persona) throw new Error("Guild routing result is missing persona");
  if (!GUILD_PERSONAS.has(persona)) throw new Error(`Guild returned unknown persona: ${persona}`);
  const specialist = String(candidate.specialist || "");
  if (!specialist) throw new Error("Guild routing result is missing the executed specialist");
  if (specialist !== persona) {
    throw new Error("Guild routing result does not match the dispatched specialist");
  }
  if (candidate.brief === undefined) {
    throw new Error("Guild routing result is missing the specialist brief");
  }

  const result = {
    persona,
    specialist,
    routingReason: candidate.rationale ? String(candidate.rationale) : "",
    specialistBrief: normalizeSpecialistBrief(candidate.brief, persona),
  };
  return result;
};

const isRootTaskEvent = (event) => {
  if (!event?.task || typeof event.task !== "object") return true;
  if (Object.prototype.hasOwnProperty.call(event.task, "parent_task_id")) {
    return event.task.parent_task_id === null;
  }
  if (Object.prototype.hasOwnProperty.call(event.task, "parent_task")) {
    return event.task.parent_task === null;
  }
  return true;
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
    this.activeControllers = new Set();
    this.closed = false;
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
    try {
      if (new URL(this.baseUrl).protocol !== "https:") {
        return "GUILD_BASE_URL must use HTTPS before API trigger credentials can be sent";
      }
    } catch {
      return "GUILD_BASE_URL must be a valid HTTPS URL";
    }
    return null;
  }

  isConfigured() {
    return this.configurationError() === null;
  }

  assertOpen() {
    if (this.closed) throw new Error("Guild client stopped");
  }

  async request(path, options = {}, timeoutMs = this.timeoutMs) {
    this.assertOpen();
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timer = setTimeout(
      () => controller.abort(new Error(`Guild request timed out after ${timeoutMs}ms`)),
      Math.max(1, timeoutMs),
    );
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
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
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        throw reason instanceof Error
          ? reason
          : new Error(`Guild request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.activeControllers.delete(controller);
    }
  }

  close() {
    this.closed = true;
    for (const controller of this.activeControllers) {
      controller.abort(new Error("Guild client stopped"));
    }
    this.activeControllers.clear();
  }

  async route(agentInput) {
    this.assertOpen();
    const configError = this.configurationError();
    if (configError) throw new Error(configError);

    const deadline = Date.now() + this.timeoutMs;
    const owner = encodeURIComponent(this.owner);
    const workspace = encodeURIComponent(this.workspace);
    const session = await this.request(`/api/workspaces/${owner}/${workspace}/sessions`, {
      method: "POST",
      body: JSON.stringify({ session_type: "api_trigger", agent_input: agentInput }),
    }, Math.max(1, deadline - Date.now()));
    if (!session?.id) throw new Error("Guild did not return a session id");
    return this.waitForResult(session.id, deadline);
  }

  async probe() {
    const probes = [
      ["strategist", {
        trigger: "plan an approach",
        goal: "survive",
        signals: [],
        memories: [],
      }],
      ["historian", {
        trigger: "remember the same pattern again",
        goal: "",
        signals: [],
        memories: ["last run"],
      }],
      ["hypecaster", {
        trigger: "tick",
        goal: "",
        signals: [{ events: ["victory"] }],
        memories: [],
      }],
      ["scout", {
        trigger: "tick",
        goal: "",
        signals: [{ events: ["next path"] }],
        memories: [],
      }],
    ];
    const routes = probes.map(async ([expected, input]) => {
      const result = await this.route(input);
      if (
        !result.specialistBrief ||
        result.persona !== expected ||
        result.specialist !== expected ||
        result.specialistBrief.persona !== expected
      ) {
        throw new Error(`Guild probe did not execute the ${expected} specialist agent`);
      }
      return expected;
    });
    let results;
    try {
      results = await Promise.all(routes);
    } catch (error) {
      // A failed canary invalidates readiness for the whole Guild stage. Keep
      // sibling pollers from issuing another request after fail-fast returns.
      this.close();
      throw error;
    }
    if (results.length !== probes.length) {
      throw new Error("Guild probe did not execute every specialist agent");
    }
    return `guild (${results.join(", ")})`;
  }

  async waitForResult(sessionId, deadline = Date.now() + this.timeoutMs) {
    while (Date.now() < deadline) {
      this.assertOpen();
      const query = new URLSearchParams({ limit: "1000" });
      const remainingMs = Math.max(1, deadline - Date.now());
      const payload = await this.request(
        `/api/sessions/${encodeURIComponent(sessionId)}/events?${query}`,
        {},
        remainingMs,
      );
      const events = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

      for (const event of events) {
        if (!isRootTaskEvent(event)) continue;
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

      const sleepMs = Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now()));
      await this.sleep(sleepMs);
      this.assertOpen();
    }

    throw new Error(`Guild agent timed out after ${this.timeoutMs}ms`);
  }
}

module.exports = {
  GuildClient,
  isRootTaskEvent,
  normalizeGuildOutput,
  normalizeSpecialistBrief,
};
