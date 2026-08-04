const path = require("node:path");

// Resolve the hackathon environment beside the application source so Finder,
// `open`, and packaged launchers do not depend on the caller's working folder.
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const bool = (v, dflt = false) =>
  v === undefined || v === "" ? dflt : /^(1|true|yes)$/i.test(v);

class ConfigError extends TypeError {}

const STT_PROVIDERS = new Set(["deepgram", "whisper", "none"]);
const MASKY_PERSONAS = ["strategist", "historian", "hypecaster", "scout"];

const positiveInt = (value, dflt, name) => {
  if (value === undefined || value.trim() === "") return dflt;
  const normalized = value.trim();
  const parsed = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive integer`);
  }
  return parsed;
};

const sttProvider = (value) => {
  const provider = (value || "none").trim().toLowerCase() || "none";
  if (!STT_PROVIDERS.has(provider)) {
    throw new ConfigError("STT_PROVIDER must be one of: deepgram, whisper, none");
  }
  return provider;
};

// The Laser SDK takes one bare connection target: `token@host` or `user:pwd@host`
// (port defaults to 8090, TLS auto-attaches for *.laserdata.cloud). The Console's
// Credentials tab hands these out as separate fields, so assemble them if the
// whole string isn't set.
const laserConnectionString = () => {
  if (process.env.LASER_CONNECTION_STRING) return process.env.LASER_CONNECTION_STRING;
  const host = process.env.LASERDATA_DOMAIN;
  if (!host) return "";
  if (process.env.LASERDATA_TOKEN) return `${process.env.LASERDATA_TOKEN}@${host}`;
  const { LASERDATA_USERNAME: user, LASERDATA_PASSWORD: pwd } = process.env;
  return user && pwd ? `${user}:${pwd}@${host}` : "";
};

const defaultMaskyAvatar = {
  avatarId: process.env.MASKY_AVATAR_ID || "",
  avatarOwnerUserId: process.env.MASKY_AVATAR_OWNER_USER_ID || "",
};

const maskyAvatars = Object.fromEntries(MASKY_PERSONAS.map((persona) => {
  const prefix = `MASKY_${persona.toUpperCase()}`;
  return [persona, {
    avatarId: process.env[`${prefix}_AVATAR_ID`] || defaultMaskyAvatar.avatarId,
    avatarOwnerUserId:
      process.env[`${prefix}_AVATAR_OWNER_USER_ID`] || defaultMaskyAvatar.avatarOwnerUserId,
  }];
}));

module.exports = {
  twitchChannel: process.env.TWITCH_CHANNEL || "",
  mockIngest: bool(process.env.MOCK_INGEST),

  minimax: {
    apiKey: process.env.MINIMAX_KEY || "",
    apiHost: process.env.MINIMAX_API_HOST || "https://api.minimax.io",
  },
  crewModel: process.env.CREW_MODEL || "MiniMax-M2.7",

  laserData: {
    connectionString: laserConnectionString(),
    stream: process.env.LASERDATA_STREAM || "humanharness-live",
    topic: process.env.LASERDATA_TOPIC || "signals",
    apiKey: process.env.LASERDATA_API_KEY || "",
    tenantId: process.env.LASERDATA_TENANT_ID || "",
  },

  falkor: {
    url: process.env.FALKORDB_URL || "",
    connectionString: process.env.FALKORDB_CONNECTION_STRING || "",
    graph: process.env.FALKORDB_GRAPH || "humanharness",
    password: process.env.FALKORDB_GRAPH_PASSWORD || "",
  },

  rocketRideApiKey: process.env.ROCKETRIDE_API_KEY || "",
  // RocketRide's MiniMax node has its own config; keep it separate from
  // CREW_MODEL so the two can move independently.
  rocketRideModel: process.env.ROCKETRIDE_MODEL || "MiniMax-M2.7",
  guild: {
    apiKey: process.env.GUILD_API_KEY || "",
    owner: process.env.GUILD_WORKSPACE_OWNER || "",
    workspace: process.env.GUILD_WORKSPACE || "",
    baseUrl: process.env.GUILD_BASE_URL || "https://app.guild.ai",
    timeoutMs: positiveInt(process.env.GUILD_TIMEOUT_MS, 60000, "GUILD_TIMEOUT_MS"),
    pollIntervalMs: positiveInt(
      process.env.GUILD_POLL_INTERVAL_MS,
      1000,
      "GUILD_POLL_INTERVAL_MS",
    ),
  },
  maskyApiKey: process.env.MASKY_API_KEY || "",
  maskyAvatarId: process.env.MASKY_AVATAR_ID || "",
  maskyAvatarOwnerUserId: process.env.MASKY_AVATAR_OWNER_USER_ID || "",
  maskyAvatars,

  stt: {
    provider: sttProvider(process.env.STT_PROVIDER),
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
  },

  frameIntervalMs: positiveInt(process.env.FRAME_INTERVAL_MS, 500, "FRAME_INTERVAL_MS"),
  labelIntervalMs: positiveInt(process.env.LABEL_INTERVAL_MS, 2000, "LABEL_INTERVAL_MS"),
  commentaryIntervalMs: positiveInt(
    process.env.COMMENTARY_INTERVAL_MS,
    8000,
    "COMMENTARY_INTERVAL_MS",
  ),
};
