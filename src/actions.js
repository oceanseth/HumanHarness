// RocketRide.ai action layer: turns "what's happening + what we remember"
// into external actions (wiki lookups, map queries, strategy tools).
//
// The Scout's lookups run as a RocketRide pipeline on RocketRide Cloud:
// webhook source -> Scout prompt -> MiniMax -> answers. connect() starts the
// pipeline once and holds the task token; each lookup is one send() into it.
// RocketRide is a mandatory stage. Missing credentials, pipeline startup
// failures, and lookup failures block the live loop.

const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { asDependencyError } = require("./dependency-error");

const CONNECT_TIMEOUT_MS = 15000;
const CLEANUP_TIMEOUT_MS = 5000;
const READINESS_POLL_MS = 250;
const RIDE_PIPE_PATH = path.join(__dirname, "..", "ride.pipe");

const withTimeout = (promise, ms, what) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

class Actions {
  constructor(config, options = {}) {
    this.apiKey = String(config.rocketRideApiKey || "").trim();
    this.minimaxApiKey = String(config.minimax?.apiKey || "").trim();
    this.minimaxApiHost = String(config.minimax?.apiHost || "").trim();
    this.model = config.rocketRideModel;
    this.log = [];
    this.loadRocketRide = options.loadRocketRide || (() => require("rocketride"));
    this.connectTimeoutMs = options.connectTimeoutMs || CONNECT_TIMEOUT_MS;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs || CLEANUP_TIMEOUT_MS;
    this.readinessPollMs = options.readinessPollMs ?? READINESS_POLL_MS;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.client = null;
    this.token = null;
    this.mode = "disconnected";
  }

  // Start the lookup pipeline and require a usable task token.
  async connect() {
    if (!this.apiKey) {
      throw asDependencyError("RocketRide", new Error("ROCKETRIDE_API_KEY is required"));
    }
    if (!this.minimaxApiKey) {
      throw asDependencyError(
        "RocketRide",
        new Error("MINIMAX_KEY is required by the RocketRide pipeline"),
      );
    }
    let minimaxBaseUrl;
    try {
      const url = new URL(this.minimaxApiHost);
      if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("unsupported protocol");
      minimaxBaseUrl = `${url.toString().replace(/\/+$/, "")}/v1`;
    } catch {
      throw asDependencyError(
        "RocketRide",
        new Error("MINIMAX_API_HOST must be a valid HTTP(S) URL"),
      );
    }

    let client = null;
    let token = null;
    try {
      const { RocketRideClient, CONST_DEFAULT_WEB_CLOUD, TASK_STATE = {} } = this.loadRocketRide();
      client = new RocketRideClient({
        auth: this.apiKey,
        uri: CONST_DEFAULT_WEB_CLOUD,
        maxRetryTime: this.connectTimeoutMs,
        requestTimeout: this.connectTimeoutMs,
      });
      const requestedToken = randomUUID();
      token = requestedToken;
      const deadline = Date.now() + this.connectTimeoutMs;
      const remaining = (what) => {
        const ms = deadline - Date.now();
        if (ms <= 0) throw new Error(`${what} timed out after ${this.connectTimeoutMs}ms`);
        return ms;
      };

      const connectRemaining = remaining("RocketRide connect");
      await withTimeout(
        client.connect(undefined, { timeout: this.connectTimeoutMs }),
        connectRemaining,
        "RocketRide connect",
      );
      const startRemaining = remaining("RocketRide pipeline start");
      const started = await withTimeout(
        client.use({
          token: requestedToken,
          filepath: RIDE_PIPE_PATH,
          env: {
            ROCKETRIDE_MINIMAX_MODEL: this.model,
            ROCKETRIDE_MINIMAX_BASE_URL: minimaxBaseUrl,
            ROCKETRIDE_MINIMAX_API_KEY: this.minimaxApiKey,
          },
          useExisting: false,
          ttl: 3600,
        }),
        startRemaining,
        "RocketRide pipeline start",
      );
      token = started?.token || (started?.pipeline && started.pipeline.token);
      if (!token) throw new Error("pipeline started without a task token");
      await this.waitUntilReady(client, token, TASK_STATE, deadline);
      this.client = client;
      this.token = token;
      this.mode = `rocketride (${this.model})`;
    } catch (err) {
      if (client) await this.cleanupClient(client, token);
      this.client = null;
      this.token = null;
      this.mode = "disconnected";
      throw asDependencyError("RocketRide", err);
    }
    return this.mode;
  }

  async waitUntilReady(client, token, taskState = {}, deadline = Date.now() + this.connectTimeoutMs) {
    const running = taskState.RUNNING ?? 3;
    const terminal = new Set([
      taskState.STOPPING ?? 4,
      taskState.COMPLETED ?? 5,
      taskState.CANCELLED ?? 6,
    ]);
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`pipeline readiness timed out after ${this.connectTimeoutMs}ms`);
      }
      const status = await withTimeout(
        client.getTaskStatus(token),
        remaining,
        "RocketRide pipeline readiness",
      );
      if (status?.state === running && status.serviceUp === true) return;
      if (status?.completed || terminal.has(status?.state)) {
        const details = [
          ...(Array.isArray(status?.errors) ? status.errors : []),
          status?.exitMessage,
          status?.exitCode ? `exit code ${status.exitCode}` : "",
        ].filter(Boolean).join("; ");
        throw new Error(`pipeline stopped before becoming ready${details ? `: ${details}` : ""}`);
      }
      await this.sleep(Math.min(this.readinessPollMs, Math.max(0, deadline - Date.now())));
    }
  }

  async cleanupClient(client, token) {
    if (token) {
      await withTimeout(
        Promise.resolve().then(() => client.terminate(token)),
        this.cleanupTimeoutMs,
        "RocketRide terminate",
      ).catch(() => {});
    }
    await withTimeout(
      Promise.resolve().then(() => client.disconnect()),
      this.cleanupTimeoutMs,
      "RocketRide disconnect",
    ).catch(() => {});
  }

  async lookup(intent) {
    this.log.push({ intent, ts: new Date().toISOString() });
    if (!this.token) {
      throw asDependencyError("RocketRide", new Error("lookup pipeline is not connected"));
    }
    try {
      const result = await this.client.send(this.token, intent, { name: "lookup.txt" }, "text/plain");
      // A failing node inside the pipeline still returns 200 with its error as
      // the answer text — don't hand that to a persona to read out loud.
      const answers = (result && result.answers) || [];
      const failed = answers.find((a) => typeof a === "string" && a.startsWith("**LLM error**"));
      if (failed) throw new Error(failed);
      if (!Array.isArray(answers) || answers.length === 0) {
        throw new Error("lookup pipeline returned no answers");
      }
      return { mock: false, intent, answers, result };
    } catch (err) {
      throw asDependencyError("RocketRide", err);
    }
  }

  async stop() {
    if (!this.client) return;
    const client = this.client;
    const token = this.token;
    this.client = null;
    this.token = null;
    this.mode = "disconnected";
    await this.cleanupClient(client, token);
  }
}

module.exports = { Actions };
