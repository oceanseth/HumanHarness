require("dotenv").config();

const bool = (v, dflt = false) =>
  v === undefined || v === "" ? dflt : /^(1|true|yes)$/i.test(v);
const int = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
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

module.exports = {
  twitchChannel: process.env.TWITCH_CHANNEL || "",
  mockIngest: bool(process.env.MOCK_INGEST),

  visionModel: process.env.VISION_MODEL || "claude-opus-5",
  crewModel: process.env.CREW_MODEL || "claude-opus-5",

  laserData: {
    connectionString: laserConnectionString(),
    stream: process.env.LASERDATA_STREAM || "humanharness-live",
    topic: process.env.LASERDATA_TOPIC || "signals",
  },

  falkor: {
    url: process.env.FALKORDB_URL || "",
    graph: process.env.FALKORDB_GRAPH || "humanharness",
  },

  rocketRideApiKey: process.env.ROCKETRIDE_API_KEY || "",
  guildApiKey: process.env.GUILD_API_KEY || "",
  maskyApiKey: process.env.MASKY_API_KEY || "",
  maskyAvatarId: process.env.MASKY_AVATAR_ID || "",
  maskyAvatarOwnerUserId: process.env.MASKY_AVATAR_OWNER_USER_ID || "",

  stt: {
    provider: (process.env.STT_PROVIDER || "none").toLowerCase(),
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
  },

  frameIntervalMs: int(process.env.FRAME_INTERVAL_MS, 500),
  labelIntervalMs: int(process.env.LABEL_INTERVAL_MS, 2000),
  commentaryIntervalMs: int(process.env.COMMENTARY_INTERVAL_MS, 8000),
};
