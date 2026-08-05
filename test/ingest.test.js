const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { ffmpegArgs, VIEWER_PLAYLIST } = require("../src/ingest");

const config = { frameIntervalMs: 500, viewerDelayMs: 120000 };

test("ffmpegArgs keeps the frame and audio outputs and appends the HLS remux", () => {
  const args = ffmpegArgs(config, { audioDir: "aud", hlsDir: "hls" });

  const pipeIndex = args.indexOf("pipe:1");
  const wavIndex = args.indexOf(path.join("aud", "seg-%05d.wav"));
  const playlistIndex = args.indexOf(path.join("hls", VIEWER_PLAYLIST));
  assert.ok(pipeIndex > 0);
  assert.ok(wavIndex > pipeIndex, "audio output follows the frame output");
  assert.ok(playlistIndex > wavIndex, "HLS output is the final output");
  assert.equal(args[args.length - 1], path.join("hls", VIEWER_PLAYLIST));

  // The viewer output must be a stream copy, never a re-encode.
  const copyIndex = args.indexOf("-c");
  assert.ok(copyIndex > wavIndex && copyIndex < playlistIndex);
  assert.equal(args[copyIndex + 1], "copy");
});

test("ffmpegArgs sizes the HLS window to cover the viewer delay plus slack", () => {
  const args = ffmpegArgs(config, { audioDir: "aud", hlsDir: "hls" });
  const listSize = Number(args[args.indexOf("-hls_list_size") + 1]);
  const segmentSeconds = Number(args[args.indexOf("-hls_time") + 1]);
  assert.ok(
    listSize * segmentSeconds >= config.viewerDelayMs / 1000 + 60,
    `window ${listSize * segmentSeconds}s must exceed delay ${config.viewerDelayMs / 1000}s with slack`,
  );
});

test("ffmpegArgs omits the HLS output when the delayed viewer is disabled", () => {
  const args = ffmpegArgs({ ...config, viewerDelayMs: 0 }, { audioDir: "aud", hlsDir: null });
  assert.equal(args.includes("hls"), false);
  assert.equal(args[args.length - 1], path.join("aud", "seg-%05d.wav"));
});
