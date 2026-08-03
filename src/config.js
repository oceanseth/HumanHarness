require("dotenv").config();

const bool = (v, dflt = false) =>
  v === undefined || v === "" ? dflt : /^(1|true|yes)$/i.test(v);
const int = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};

module.exports = {
  twitchChannel: process.env.TWITCH_CHANNEL || "",
  mockIngest: bool(process.env.MOCK_INGEST),

  visionModel: process.env.VISION_MODEL || "claude-opus-5",
  crewModel: process.env.CREW_MODEL || "claude-opus-5",

  laserData: {
    apiKey: process.env.LASERDATA_API_KEY || "",
    endpoint: process.env.LASERDATA_ENDPOINT || "",
    stream: process.env.LASERDATA_STREAM || "humanharness-live",
  },

  falkor: {
    url: process.env.FALKORDB_URL || "",
    graph: process.env.FALKORDB_GRAPH || "humanharness",
  },

  rocketRideApiKey: process.env.ROCKETRIDE_API_KEY || "",
  guildApiKey: process.env.GUILD_API_KEY || "",
  maskyApiKey: process.env.MASKY_API_KEY || "",

  stt: {
    provider: (process.env.STT_PROVIDER || "none").toLowerCase(),
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
  },

  frameIntervalMs: int(process.env.FRAME_INTERVAL_MS, 500),
  labelIntervalMs: int(process.env.LABEL_INTERVAL_MS, 2000),
  commentaryIntervalMs: int(process.env.COMMENTARY_INTERVAL_MS, 8000),
};
