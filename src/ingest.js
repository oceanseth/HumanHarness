const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AUDIO_SEGMENT_SECONDS = 5;
const HLS_SEGMENT_SECONDS = 2;
// Keep enough playlist behind the live edge for the delayed viewer position to
// stay inside the sliding window, plus slack for stalls and player buffering.
const HLS_WINDOW_SLACK_SECONDS = 90;
const VIEWER_PLAYLIST = "live.m3u8";

// One ffmpeg over the single streamlink pull, fanned into up to three outputs:
// the MJPEG analysis frames, the STT WAV segments, and (when the delayed
// viewer is enabled) a stream-copy HLS remux the renderer plays as real video.
const ffmpegArgs = (config, { audioDir, hlsDir }) => {
  const fps = 1000 / config.frameIntervalMs;
  const args = [
    "-loglevel", "error",
    "-i", "pipe:0",
    // frame stream -> stdout
    "-vf", `fps=${fps}`,
    "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1",
    // audio segments -> temp dir
    "-vn", "-ac", "1", "-ar", "16000",
    "-f", "segment", "-segment_time", String(AUDIO_SEGMENT_SECONDS),
    path.join(audioDir, "seg-%05d.wav"),
  ];
  if (hlsDir) {
    const windowSeconds = config.viewerDelayMs / 1000 + HLS_WINDOW_SLACK_SECONDS;
    args.push(
      // viewer remux -> rolling local HLS window, no re-encode
      "-c", "copy",
      "-f", "hls",
      "-hls_time", String(HLS_SEGMENT_SECONDS),
      "-hls_list_size", String(Math.ceil(windowSeconds / HLS_SEGMENT_SECONDS)),
      "-hls_flags", "delete_segments+append_list+independent_segments",
      "-hls_segment_filename", path.join(hlsDir, "seg-%05d.ts"),
      path.join(hlsDir, VIEWER_PLAYLIST),
    );
  }
  return args;
};

// Pulls the Twitch HLS feed via streamlink, splits it with ffmpeg into an
// MJPEG frame stream (one JPEG every FRAME_INTERVAL_MS, on stdout), 5s
// mono 16kHz WAV audio segments (to a temp dir, for STT), and — when
// VIEWER_DELAY_MS > 0 — a rolling local HLS window for the delayed viewer.
//
// Emits: "frame" (Buffer jpeg, capturedAt ms), "audio" (path to wav segment,
// capturedAt ms), "viewer" ({ hlsDir, playlist }), "status" (string).
class Ingest extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.procs = [];
    this.mockTimer = null;
    this.audioWatcher = null;
  }

  start() {
    if (this.config.mockIngest || !this.config.twitchChannel) {
      this.startMock();
      return;
    }
    const fps = 1000 / this.config.frameIntervalMs;
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-audio-"));
    const hlsDir = this.config.viewerDelayMs > 0
      ? fs.mkdtempSync(path.join(os.tmpdir(), "hh-hls-"))
      : null;

    const streamlink = spawn("streamlink", [
      "--stdout",
      `twitch.tv/${this.config.twitchChannel}`,
      "best",
    ]);
    const ffmpeg = spawn("ffmpeg", ffmpegArgs(this.config, { audioDir, hlsDir }));
    streamlink.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdin.on("error", () => {}); // EPIPE when ffmpeg exits first

    let buf = Buffer.alloc(0);
    ffmpeg.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // Split the MJPEG stream on JPEG SOI (FFD8) / EOI (FFD9) markers.
      for (;;) {
        const soi = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (soi < 0) { buf = Buffer.alloc(0); break; }
        const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
        if (eoi < 0) { buf = buf.subarray(soi); break; }
        this.emit("frame", buf.subarray(soi, eoi + 2), Date.now());
        buf = buf.subarray(eoi + 2);
      }
    });

    // Segment N is complete once segment N+1 appears.
    const seen = new Set();
    this.audioWatcher = setInterval(() => {
      let names;
      try { names = fs.readdirSync(audioDir).filter((n) => n.endsWith(".wav")).sort(); }
      catch { return; }
      for (const name of names.slice(0, -1)) {
        if (!seen.has(name)) {
          seen.add(name);
          // The segment covers the ~5s before it completed, and completion is
          // noticed up to 1s late — stamp its approximate capture start.
          this.emit(
            "audio",
            path.join(audioDir, name),
            Date.now() - AUDIO_SEGMENT_SECONDS * 1000 - 1000,
          );
        }
      }
    }, 1000);

    if (hlsDir) this.emit("viewer", { hlsDir, playlist: VIEWER_PLAYLIST });

    for (const [proc, label] of [[streamlink, "streamlink"], [ffmpeg, "ffmpeg"]]) {
      proc.on("error", (err) =>
        this.emit("status", `${label} failed to start: ${err.message} — is it on PATH? (set MOCK_INGEST=true to demo without a stream)`));
      proc.stderr.on("data", (d) => this.emit("status", `${label}: ${d.toString().trim()}`));
      this.procs.push(proc);
    }
    this.emit("status", `ingesting twitch.tv/${this.config.twitchChannel} at ${fps.toFixed(1)} fps`);
  }

  // Demo mode: no stream, no binaries — emits scripted scene labels directly
  // (pipeline.js sees "mock-labels" and skips the vision model).
  startMock() {
    const scenes = [
      { scene: "boss arena, low health bar", objects: ["boss", "health bar", "player"], events: ["boss winds up slam attack"] },
      { scene: "player dodges left, opening appears", objects: ["boss", "player"], events: ["dodge roll", "attack window opens"] },
      { scene: "victory screen", objects: ["victory banner", "loot"], events: ["boss defeated"] },
      { scene: "city street, market stalls", objects: ["stalls", "crowd", "street sign"], events: ["player enters market district"] },
    ];
    let i = 0;
    this.emit("status", "mock ingest: emitting scripted scene labels (no stream)");
    this.mockTimer = setInterval(() => {
      this.emit("mock-labels", { ...scenes[i % scenes.length], ts: new Date().toISOString() });
      i++;
    }, this.config.labelIntervalMs);
  }

  stop() {
    if (this.mockTimer) clearInterval(this.mockTimer);
    if (this.audioWatcher) clearInterval(this.audioWatcher);
    for (const p of this.procs) { try { p.kill("SIGKILL"); } catch {} }
    this.procs = [];
  }
}

module.exports = { Ingest, ffmpegArgs, VIEWER_PLAYLIST };
