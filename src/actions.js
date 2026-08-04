// RocketRide.ai action layer: turns "what's happening + what we remember"
// into external actions (wiki lookups, map queries, strategy tools).
//
// The Scout's lookups run as a RocketRide pipeline on RocketRide Cloud:
// webhook source -> Scout prompt -> MiniMax -> answers. connect() starts the
// pipeline once and holds the task token; each lookup is one send() into it.
// Without a RocketRide key this stays a mock that records the intent and
// returns nothing, so the crew still runs but performs no external calls.

const path = require("node:path");

const CONNECT_TIMEOUT_MS = 15000;
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
  constructor(config) {
    this.apiKey = config.rocketRideApiKey;
    this.minimaxApiKey = config.minimax.apiKey;
    this.minimaxBaseUrl = `${config.minimax.apiHost.replace(/\/+$/, "")}/v1`;
    this.model = config.rocketRideModel;
    this.log = [];
    this.client = null;
    this.token = null;
    this.mode = "mock";
  }

  // Start the lookup pipeline. Returns a status string for the UI log.
  // Startup never depends on RocketRide; the mock always serves.
  async connect() {
    if (!this.apiKey) return this.mode;
    if (!this.minimaxApiKey) {
      this.mode = "mock (RocketRide key set but MINIMAX_KEY is not — the lookup pipeline needs it)";
      return this.mode;
    }

    const open = async () => {
      const { RocketRideClient, CONST_DEFAULT_WEB_CLOUD } = require("rocketride");
      const client = new RocketRideClient({ auth: this.apiKey, uri: CONST_DEFAULT_WEB_CLOUD });
      await client.connect();
      const started = await client.use({
        filepath: RIDE_PIPE_PATH,
        env: {
          ROCKETRIDE_MINIMAX_MODEL: this.model,
          ROCKETRIDE_MINIMAX_BASE_URL: this.minimaxBaseUrl,
          ROCKETRIDE_MINIMAX_API_KEY: this.minimaxApiKey,
        },
        useExisting: true,
        ttl: 0,
      });
      const token = started.token || (started.pipeline && started.pipeline.token);
      if (!token) throw new Error("pipeline started without a task token");
      return { client, token };
    };

    const opening = open();
    try {
      const opened = await withTimeout(opening, CONNECT_TIMEOUT_MS, "RocketRide connect");
      this.client = opened.client;
      this.token = opened.token;
      this.mode = `rocketride (${this.model})`;
    } catch (err) {
      this.client = null;
      this.token = null;
      this.mode = `mock (RocketRide unavailable: ${err.message})`;
      // a pipeline that starts after the timeout would otherwise stay running
      opening.then((late) => late.client.disconnect()).catch(() => {});
    }
    return this.mode;
  }

  async lookup(intent) {
    this.log.push({ intent, ts: new Date().toISOString() });
    if (!this.token) {
      return { mock: true, note: `RocketRide mock — would look up: ${intent}` };
    }
    try {
      const result = await this.client.send(this.token, intent, { name: "lookup.txt" }, "text/plain");
      // A failing node inside the pipeline still returns 200 with its error as
      // the answer text — don't hand that to a persona to read out loud.
      const answers = (result && result.answers) || [];
      const failed = answers.find((a) => typeof a === "string" && a.startsWith("**LLM error**"));
      if (failed) return { mock: true, error: failed, note: `RocketRide lookup failed: ${intent}` };
      return { mock: false, intent, answers, result };
    } catch (err) {
      return { mock: true, error: err.message, note: `RocketRide lookup failed: ${intent}` };
    }
  }

  async stop() {
    if (!this.client) return;
    try {
      if (this.token) await this.client.terminate(this.token);
      await this.client.disconnect();
    } catch {
      // engine already gone; nothing to release
    }
    this.client = null;
    this.token = null;
  }
}

module.exports = { Actions };
