const { EventEmitter } = require("events");
const { Ingest } = require("./ingest");
const { Perceiver } = require("./perceive");
const { SignalStream } = require("./signals");
const { Memory } = require("./memory");
const { Actions } = require("./actions");
const { Crew } = require("./crew");
const { transcribe } = require("./stt");

// The core loop: ingest -> perceive -> LaserData signals -> FalkorDB memory
// -> RocketRide actions -> Guild-routed personas -> masky voices.
// Emits UI events: "frame", "labels", "transcript", "commentary", "status".
class Pipeline extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    this.signals = new SignalStream(this.config);
    this.memory = new Memory(this.config);
    this.actions = new Actions(this.config);
    this.crew = new Crew(this.config, this.memory, this.actions);
    this.perceiver = new Perceiver(this.config);
    this.ingest = new Ingest(this.config);

    const memMode = await this.memory.connect();
    this.emit("status", `memory: ${memMode}`);

    // signals feed both memory and the crew's working context
    this.signals.on("signal", (event) => {
      this.crew.observe(event);
      if (event.kind === "labels") this.memory.record(event);
    });

    let lastLabel = 0;
    this.ingest.on("frame", async (jpeg) => {
      this.emit("frame", jpeg.toString("base64"));
      const now = Date.now();
      if (now - lastLabel < this.config.labelIntervalMs) return;
      lastLabel = now;
      const labels = await this.perceiver.label(jpeg);
      if (!labels) return;
      if (labels.error) return this.emit("status", `vision: ${labels.error}`);
      this.emit("labels", labels);
      this.signals.publish("labels", labels);
    });

    this.ingest.on("mock-labels", (labels) => {
      this.emit("labels", labels);
      this.signals.publish("labels", labels);
    });

    this.ingest.on("audio", async (wavPath) => {
      const text = await transcribe(wavPath, this.config.stt);
      if (!text || !text.trim()) return;
      this.emit("transcript", text);
      this.signals.publish("speech", { text });
      this.say(text); // the crew hears the human immediately
    });

    this.ingest.on("status", (msg) => this.emit("status", msg));
    this.ingest.start();

    this.commentaryTimer = setInterval(() => this.say("tick"), this.config.commentaryIntervalMs);
    this.emit("status", "pipeline running");
  }

  async say(trigger) {
    const out = await this.crew.speak(trigger);
    if (!out) return;
    if (out.error) return this.emit("status", `crew: ${out.error}`);
    if (out.line) this.emit("commentary", out);
  }

  setGoal(goal) {
    if (this.crew) this.crew.setGoal(goal);
    if (this.signals) this.signals.publish("goal", { text: goal });
    this.emit("status", `goal set: ${goal}`);
  }

  // Text input from the UI stands in for the mic when STT is off.
  userSays(text) {
    if (!this.running || !text.trim()) return;
    this.emit("transcript", text);
    this.signals.publish("speech", { text });
    this.say(text);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.commentaryTimer);
    if (this.ingest) this.ingest.stop();
    this.emit("status", "pipeline stopped");
  }
}

module.exports = { Pipeline };
