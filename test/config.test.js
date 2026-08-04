const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const configKeys = [
  "STT_PROVIDER",
  "FRAME_INTERVAL_MS",
  "LABEL_INTERVAL_MS",
  "COMMENTARY_INTERVAL_MS",
  "GUILD_TIMEOUT_MS",
  "GUILD_POLL_INTERVAL_MS",
];
const inspectConfig = `
  const config = require("./src/config");
  process.stdout.write(JSON.stringify({
    stt: config.stt.provider,
    frame: config.frameIntervalMs,
    label: config.labelIntervalMs,
    commentary: config.commentaryIntervalMs,
    guildTimeout: config.guild.timeoutMs,
    guildPoll: config.guild.pollIntervalMs,
  }));
`;

function readConfig(overrides = {}) {
  const env = { ...process.env };
  for (const key of configKeys) env[key] = "";
  Object.assign(env, overrides);

  return spawnSync(process.execPath, ["-e", inspectConfig], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

test("config preserves live defaults for empty STT and interval settings", () => {
  const run = readConfig();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    stt: "none",
    frame: 500,
    label: 2000,
    commentary: 8000,
    guildTimeout: 60000,
    guildPoll: 1000,
  });
});

test("config normalizes supported STT providers", () => {
  for (const [input, expected] of [
    ["deepgram", "deepgram"],
    [" Whisper ", "whisper"],
    ["none", "none"],
  ]) {
    const run = readConfig({ STT_PROVIDER: input });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).stt, expected);
  }
});

test("config rejects unsupported STT providers", () => {
  const run = readConfig({ STT_PROVIDER: "assemblyai" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /STT_PROVIDER must be one of: deepgram, whisper, none/);
});

test("config parses positive timing intervals", () => {
  const run = readConfig({
    FRAME_INTERVAL_MS: "250",
    LABEL_INTERVAL_MS: "750",
    COMMENTARY_INTERVAL_MS: "3000",
    GUILD_TIMEOUT_MS: "12000",
    GUILD_POLL_INTERVAL_MS: "250",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    stt: "none",
    frame: 250,
    label: 750,
    commentary: 3000,
    guildTimeout: 12000,
    guildPoll: 250,
  });
});

for (const [name, value] of [
  ["FRAME_INTERVAL_MS", "0"],
  ["LABEL_INTERVAL_MS", "-1"],
  ["COMMENTARY_INTERVAL_MS", "2 seconds"],
  ["GUILD_TIMEOUT_MS", "0"],
  ["GUILD_POLL_INTERVAL_MS", "-1"],
]) {
  test(`config rejects invalid ${name}`, () => {
    const run = readConfig({ [name]: value });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, new RegExp(`${name} must be a positive integer`));
  });
}
