const { EventEmitter } = require("events");
const { Ingest } = require("./ingest");
const { Perceiver } = require("./perceive");
const { SignalStream } = require("./signals");
const { Memory } = require("./memory");
const { Actions } = require("./actions");
const { Crew } = require("./crew");
const { Voices } = require("./voices");
const { transcribe } = require("./stt");
const { DependencyError, asDependencyError } = require("./dependency-error");

class StartupCancelledError extends Error {}

const DRAIN_TIMEOUT_MS = 5000;

const settleWithin = async (promise, timeoutMs) => {
  let timer;
  await Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

// Mandatory readiness and data order:
// LaserData -> FalkorDB -> RocketRide -> Guild. Ingest does not start until
// all four stages have proved they are usable, and any later stage failure
// tears down the entire run.
class Pipeline extends EventEmitter {
  constructor(config, factories = {}) {
    super();
    this.config = config;
    this.factories = {
      signals: factories.signals || ((value) => new SignalStream(value)),
      memory: factories.memory || ((value) => new Memory(value)),
      actions: factories.actions || ((value) => new Actions(value)),
      crew: factories.crew || ((value, memory, actions) => new Crew(value, memory, actions)),
      perceiver: factories.perceiver || ((value) => new Perceiver(value)),
      ingest: factories.ingest || ((value) => new Ingest(value)),
      voices: factories.voices || ((value) => new Voices(value)),
      transcribe: factories.transcribe || transcribe,
    };
    this.drainTimeoutMs = factories.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
    this.running = false;
    this.state = "stopped";
    this.generation = 0;
    this.run = null;
    this.startPromise = null;
    this.stopPromise = null;
    this.blockPromise = null;
  }

  createRun(generation) {
    const signals = this.factories.signals(this.config);
    const memory = this.factories.memory(this.config);
    const actions = this.factories.actions(this.config);
    const crew = this.factories.crew(this.config, memory, actions);
    return {
      generation,
      accepting: true,
      signals,
      memory,
      actions,
      crew,
      perceiver: this.factories.perceiver(this.config),
      ingest: this.factories.ingest(this.config),
      voices: this.factories.voices(this.config),
      inFlight: new Set(),
      timer: null,
      teardownPromise: null,
      lastLabel: 0,
    };
  }

  exposeRun(run) {
    this.signals = run.signals;
    this.memory = run.memory;
    this.actions = run.actions;
    this.crew = run.crew;
    this.perceiver = run.perceiver;
    this.ingest = run.ingest;
    this.voices = run.voices;
  }

  start() {
    if (this.running) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    if (this.stopPromise) return this.stopPromise.then(() => this.start());
    if (this.blockPromise) return this.blockPromise.then(() => this.start());

    let run;
    try {
      run = this.createRun(++this.generation);
    } catch (error) {
      const blocker = asDependencyError("Pipeline", error);
      this.running = false;
      this.state = "blocked";
      this.blocked = blocker;
      this.emit("status", `BLOCKED ${blocker.message}`);
      return Promise.reject(blocker);
    }
    this.run = run;
    this.exposeRun(run);
    const trackedStart = this.startInternal(run).finally(() => {
      if (this.startPromise === trackedStart) this.startPromise = null;
    });
    this.startPromise = trackedStart;
    return this.startPromise;
  }

  assertCurrent(run) {
    if (this.run !== run || run.generation !== this.generation || !run.accepting) {
      throw new StartupCancelledError("startup cancelled");
    }
  }

  isActive(run) {
    return this.run === run &&
      run.generation === this.generation &&
      run.accepting &&
      this.running &&
      this.state === "running";
  }

  async readyStage(service, connect, disconnect, run) {
    this.emit("status", `checking ${service}`);
    try {
      const mode = await connect();
      try {
        this.assertCurrent(run);
      } catch (error) {
        // Teardown may already have passed this adapter while its handshake
        // was still pending. Close any resource acquired after cancellation.
        await settleWithin(
          Promise.resolve().then(() => disconnect()),
          this.drainTimeoutMs,
        );
        throw error;
      }
      this.emit("status", `${service}: ready (${mode})`);
      return mode;
    } catch (error) {
      if (
        error instanceof StartupCancelledError ||
        this.run !== run ||
        run.generation !== this.generation ||
        !run.accepting
      ) {
        throw new StartupCancelledError("startup cancelled");
      }
      throw asDependencyError(service, error);
    }
  }

  async startInternal(run) {
    this.state = "starting";
    this.blocked = null;
    try {
      await this.readyStage(
        "LaserData",
        () => run.signals.connect(),
        () => run.signals.close(),
        run,
      );
      await this.readyStage(
        "FalkorDB",
        () => run.memory.connect(),
        () => run.memory.close(),
        run,
      );
      await this.readyStage(
        "RocketRide",
        () => run.actions.connect(),
        () => run.actions.stop(),
        run,
      );
      await this.readyStage(
        "Guild",
        () => run.crew.connect(),
        () => run.crew.stop(),
        run,
      );

      run.voices.on("status", (message) => this.emit("status", message));
      await run.voices.start();
      try {
        this.assertCurrent(run);
      } catch (error) {
        await settleWithin(
          Promise.resolve().then(() => run.voices.stop()),
          this.drainTimeoutMs,
        );
        throw error;
      }

      this.bindRuntime(run);
      this.running = true;
      this.state = "running";
      run.ingest.start();
      this.assertCurrent(run);

      run.timer = setInterval(
        () => this.track(run, this.say("tick", run)),
        this.config.commentaryIntervalMs,
      );
      this.emit("status", "pipeline running: LaserData -> FalkorDB -> RocketRide -> Guild");
    } catch (error) {
      await this.teardownRun(run);
      this.running = false;
      if (error instanceof StartupCancelledError) {
        if (this.run === run) this.state = "stopped";
        throw error;
      }
      const blocker = error instanceof DependencyError
        ? error
        : asDependencyError("Pipeline", error);
      this.blocked = blocker;
      this.state = "blocked";
      this.emit("status", `BLOCKED ${blocker.message}`);
      throw blocker;
    }
  }

  bindRuntime(run) {
    run.ingest.on("frame", (jpeg) => this.track(run, this.handleFrame(jpeg, run)));
    run.ingest.on("mock-labels", (labels) => this.track(run, this.handleLabels(labels, run)));
    run.ingest.on("audio", (wavPath) => this.track(run, this.handleAudio(wavPath, run)));
    run.ingest.on("status", (message) => {
      if (this.isActive(run)) this.emit("status", message);
    });
  }

  track(run, promise) {
    const tracked = Promise.resolve(promise);
    run.inFlight.add(tracked);
    tracked.then(
      () => run.inFlight.delete(tracked),
      (error) => {
        run.inFlight.delete(tracked);
        void this.block(error, run);
      },
    );
    return tracked;
  }

  async acceptSignal(kind, payload, run = this.run) {
    if (!this.isActive(run)) return null;
    const event = await run.signals.publish(kind, payload);
    if (!this.isActive(run)) return null;
    await run.memory.record(event);
    if (!this.isActive(run)) return null;
    run.crew.observe(event);
    return event;
  }

  async handleFrame(jpeg, run) {
    if (!this.isActive(run)) return;
    this.emit("frame", jpeg.toString("base64"));
    const now = Date.now();
    if (now - run.lastLabel < this.config.labelIntervalMs) return;
    run.lastLabel = now;
    const labels = await run.perceiver.label(jpeg);
    if (!this.isActive(run)) return;
    // A slower MiniMax vision request can overlap a later frame. Perceiver
    // returns null for that backpressure case while the real request remains
    // in flight; only an explicit provider error blocks the mandatory chain.
    if (!labels) return;
    if (labels.error) throw asDependencyError("MiniMax", new Error(labels.error));
    this.emit("labels", labels);
    await this.acceptSignal("labels", labels, run);
  }

  async handleLabels(labels, run) {
    if (!this.isActive(run)) return;
    this.emit("labels", labels);
    await this.acceptSignal("labels", labels, run);
  }

  async handleAudio(wavPath, run) {
    if (!this.isActive(run)) return;
    let text;
    try {
      text = await this.factories.transcribe(wavPath, this.config.stt);
    } catch (error) {
      throw asDependencyError("STT", error);
    }
    if (!this.isActive(run) || !text || !text.trim()) return;
    await this.acceptSignal("speech", { text }, run);
    if (!this.isActive(run)) return;
    this.emit("transcript", text);
    await this.say(text, run);
  }

  async say(trigger, run = this.run) {
    if (!this.isActive(run)) return;
    const out = await run.crew.speak(trigger);
    if (!this.isActive(run) || !out) return;
    if (out.line) {
      this.emit("commentary", out);
      const audio = await run.voices.speak(out.persona, out.line);
      if (audio && this.isActive(run)) this.emit("audio", audio);
    }
  }

  setGoal(goal) {
    const run = this.run;
    if (!this.isActive(run) || !goal.trim()) return Promise.resolve();
    const task = (async () => {
      run.crew.setGoal(goal);
      await this.acceptSignal("goal", { text: goal }, run);
      if (this.isActive(run)) this.emit("status", `goal set: ${goal}`);
    })();
    return this.track(run, task);
  }

  userSays(text) {
    const run = this.run;
    if (!this.isActive(run) || !text.trim()) return Promise.resolve();
    const task = (async () => {
      await this.acceptSignal("speech", { text }, run);
      if (!this.isActive(run)) return;
      this.emit("transcript", text);
      await this.say(text, run);
    })();
    return this.track(run, task);
  }

  async teardownRun(run) {
    if (run.teardownPromise) return run.teardownPromise;
    run.teardownPromise = (async () => {
      run.accepting = false;
      if (run.timer) {
        clearInterval(run.timer);
        run.timer = null;
      }
      await settleWithin(
        Promise.resolve().then(() => run.ingest.stop()),
        this.drainTimeoutMs,
      );
      await settleWithin(
        Promise.resolve().then(() => run.voices.stop()),
        this.drainTimeoutMs,
      );

      // Cancel the mandatory chain in reverse before waiting for work that may
      // be stuck inside a service request. Each adapter gets a bounded cleanup
      // window so one dead connection cannot prevent the remaining teardown.
      await settleWithin(
        Promise.resolve().then(() => run.crew.stop()),
        this.drainTimeoutMs,
      );
      await settleWithin(
        Promise.resolve().then(() => run.actions.stop()),
        this.drainTimeoutMs,
      );
      await settleWithin(
        Promise.resolve().then(() => run.memory.close()),
        this.drainTimeoutMs,
      );
      await settleWithin(
        Promise.resolve().then(() => run.signals.close()),
        this.drainTimeoutMs,
      );
      if (run.inFlight.size) {
        await settleWithin(Promise.allSettled([...run.inFlight]), this.drainTimeoutMs);
      }
    })();
    return run.teardownPromise;
  }

  async block(error, run = this.run) {
    if (this.run !== run || !run?.accepting || this.state === "blocked") return;
    if (this.blockPromise) return this.blockPromise;
    const blocker = error instanceof DependencyError
      ? error
      : asDependencyError(error?.service || "Pipeline", error);
    this.blockPromise = (async () => {
      this.running = false;
      this.state = "blocked";
      this.blocked = blocker;
      run.accepting = false;
      this.generation += 1;
      await this.teardownRun(run);
      this.emit("status", `BLOCKED ${blocker.message}`);
    })().finally(() => {
      this.blockPromise = null;
    });
    return this.blockPromise;
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    const run = this.run;
    this.stopPromise = (async () => {
      this.running = false;
      this.state = "stopping";
      if (run) run.accepting = false;
      this.generation += 1;
      const starting = this.startPromise;
      const blocking = this.blockPromise;

      // Close partially acquired resources before waiting on startup. A
      // dependency handshake may never settle, so neither it nor a concurrent
      // blocker may hold application shutdown open indefinitely.
      if (run) await this.teardownRun(run);
      if (starting) {
        await settleWithin(starting, this.drainTimeoutMs);
        if (this.startPromise === starting) this.startPromise = null;
      }
      if (blocking) await settleWithin(blocking, this.drainTimeoutMs);
      if (this.run === run) this.run = null;
      this.state = "stopped";
      this.emit("status", "pipeline stopped");
    })().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }
}

module.exports = { Pipeline };
