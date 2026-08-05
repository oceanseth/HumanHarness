const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { DependencyError } = require("../src/dependency-error");
const { Pipeline } = require("../src/pipeline");

const config = {
  commentaryIntervalMs: 60_000,
  labelIntervalMs: 500,
  stt: { provider: "none" },
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function createHarness(options = {}) {
  const log = [];
  const instances = { signals: [], memories: [], actions: [], crews: [] };
  const failure = options.failure || new Error("dependency failed");

  const connectable = (service, closeName, extra = {}) => {
    let connected = false;
    return {
      ...extra,
      async connect() {
        log.push(`${service}:connect`);
        if (options.connectGate?.service === service) await options.connectGate.gate.promise;
        connected = true;
        if (options.failAt === service) throw failure;
        return service.toLowerCase();
      },
      async [closeName]() {
        if (!connected) return;
        connected = false;
        log.push(`${service}:close`);
      },
    };
  };

  const factories = {
    signals: () => {
      const signals = connectable("LaserData", "close", {
        async publish(kind, payload) {
          log.push(`LaserData:publish:${kind}`);
          if (options.publishGate) await options.publishGate.promise;
          if (options.publishError) throw options.publishError;
          return { kind, ts: "now", ...payload };
        },
      });
      instances.signals.push(signals);
      return signals;
    },
    memory: () => {
      const memory = connectable("FalkorDB", "close", {
        async record(event) { log.push(`FalkorDB:record:${event.kind}`); },
        async recall() { log.push("FalkorDB:recall"); return []; },
      });
      instances.memories.push(memory);
      return memory;
    },
    actions: () => {
      const actions = connectable("RocketRide", "stop", {
        async lookup() { return { answers: ["answer"] }; },
      });
      instances.actions.push(actions);
      return actions;
    },
    crew: (_value, memory, actions) => {
      let connected = false;
      const crew = {
        memory,
        actions,
        async connect() {
          log.push("Guild:connect");
          if (options.connectGate?.service === "Guild") await options.connectGate.gate.promise;
          connected = true;
          if (options.failAt === "Guild") throw failure;
          return "guild";
        },
        async stop() {
          if (!connected) return;
          connected = false;
          log.push("Guild:close");
        },
        observe(event) { log.push(`Guild:observe:${event.kind}`); },
        setGoal() {},
        async speak() { return null; },
      };
      instances.crews.push(crew);
      return crew;
    },
    perceiver: () => ({ label: async () => ({ scene: "arena", objects: [], events: [] }) }),
    ingest: () => {
      const ingest = new EventEmitter();
      let started = false;
      ingest.start = () => { started = true; log.push("Ingest:start"); };
      ingest.stop = async () => {
        if (!started) return;
        started = false;
        log.push("Ingest:close");
      };
      return ingest;
    },
    voices: () => {
      const voices = new EventEmitter();
      let started = false;
      voices.start = async () => { started = true; log.push("Voices:start"); };
      voices.stop = async () => {
        if (!started) return;
        started = false;
        log.push("Voices:close");
      };
      voices.speak = async () => null;
      return voices;
    },
    transcribe: async () => "",
  };

  return { factories, instances, log };
}

test("Pipeline starts mandatory services in order and stops them in reverse", async () => {
  const { factories, log } = createHarness();
  const pipeline = new Pipeline(config, factories);

  await pipeline.start();

  assert.equal(pipeline.running, true);
  assert.deepEqual(log.slice(0, 6), [
    "LaserData:connect",
    "FalkorDB:connect",
    "RocketRide:connect",
    "Guild:connect",
    "Voices:start",
    "Ingest:start",
  ]);

  await pipeline.stop();
  assert.deepEqual(log.slice(-6), [
    "Ingest:close",
    "Voices:close",
    "Guild:close",
    "RocketRide:close",
    "FalkorDB:close",
    "LaserData:close",
  ]);
});

for (const [service, attempted] of [
  ["LaserData", ["LaserData:connect"]],
  ["FalkorDB", ["LaserData:connect", "FalkorDB:connect"]],
  ["RocketRide", ["LaserData:connect", "FalkorDB:connect", "RocketRide:connect"]],
  ["Guild", ["LaserData:connect", "FalkorDB:connect", "RocketRide:connect", "Guild:connect"]],
]) {
  test(`Pipeline blocks at ${service} and starts no later dependency`, async () => {
    const sentinel = new Error(`${service} down`);
    const { factories, log } = createHarness({ failAt: service, failure: sentinel });
    const pipeline = new Pipeline(config, factories);
    const statuses = [];
    pipeline.on("status", (status) => statuses.push(status));

    await assert.rejects(
      () => pipeline.start(),
      (error) => error.service === service && error.cause === sentinel,
    );

    assert.deepEqual(log.filter((entry) => entry.endsWith(":connect")), attempted);
    assert.equal(log.includes("Voices:start"), false);
    assert.equal(log.includes("Ingest:start"), false);
    assert.equal(pipeline.running, false);
    assert.equal(pipeline.state, "blocked");
    assert.ok(statuses.some((status) => status.startsWith(`BLOCKED ${service}:`)));
  });
}

test("Pipeline stop during startup waits and closes the late connection", async () => {
  const gate = deferred();
  const { factories, log } = createHarness({ connectGate: { service: "LaserData", gate } });
  const pipeline = new Pipeline(config, factories);

  const starting = pipeline.start();
  const stopping = pipeline.stop();
  gate.resolve();

  await assert.rejects(starting, /startup cancelled/);
  await stopping;
  assert.ok(log.includes("LaserData:close"));
  assert.equal(log.includes("FalkorDB:connect"), false);
  assert.equal(pipeline.state, "stopped");
});

test("Pipeline stop bounds a startup handshake that never settles", async () => {
  const gate = deferred();
  const harness = createHarness({ connectGate: { service: "LaserData", gate } });
  const pipeline = new Pipeline(config, { ...harness.factories, drainTimeoutMs: 10 });

  const starting = pipeline.start();
  await pipeline.stop();

  assert.equal(pipeline.state, "stopped");
  assert.equal(pipeline.startPromise, null);
  assert.equal(harness.log.includes("FalkorDB:connect"), false);

  // The detached startup may settle later, but it cannot overwrite the
  // stopped state or touch a later dependency.
  gate.resolve();
  await assert.rejects(starting, /startup cancelled/);
  assert.equal(pipeline.state, "stopped");
  assert.equal(harness.log.filter((entry) => entry === "LaserData:close").length, 1);
  assert.equal(harness.log.includes("FalkorDB:connect"), false);
});

test("Pipeline drains an old publish before restart without cross-run writes", async () => {
  const publishGate = deferred();
  const harness = createHarness({ publishGate });
  const pipeline = new Pipeline(config, harness.factories);
  await pipeline.start();

  const speech = pipeline.userSays("remember this");
  const stopping = pipeline.stop();
  let stopFinished = false;
  stopping.then(() => { stopFinished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopFinished, false);

  publishGate.resolve();
  await speech;
  await stopping;
  await pipeline.start();

  assert.equal(harness.log.includes("FalkorDB:record:speech"), false);
  assert.equal(harness.log.includes("Guild:observe:speech"), false);
  await pipeline.stop();
});

test("Pipeline cancels dependencies before bounding a permanently pending publish", async () => {
  const publishGate = deferred();
  const harness = createHarness({ publishGate });
  const pipeline = new Pipeline(config, { ...harness.factories, drainTimeoutMs: 10 });
  await pipeline.start();

  void pipeline.userSays("never resolves");
  await pipeline.stop();

  assert.equal(pipeline.state, "stopped");
  assert.deepEqual(harness.log.slice(-6), [
    "Ingest:close",
    "Voices:close",
    "Guild:close",
    "RocketRide:close",
    "FalkorDB:close",
    "LaserData:close",
  ]);
});

test("Pipeline converts a runtime LaserData failure into a full blocker", async () => {
  const error = new DependencyError("LaserData", "publish failed");
  const { factories, log } = createHarness({ publishError: error });
  const pipeline = new Pipeline(config, factories);
  await pipeline.start();

  await assert.rejects(() => pipeline.userSays("hello"), /LaserData: publish failed/);
  await new Promise((resolve) => setImmediate(resolve));
  if (pipeline.blockPromise) await pipeline.blockPromise;

  assert.equal(pipeline.state, "blocked");
  assert.equal(pipeline.running, false);
  assert.deepEqual(log.slice(-6), [
    "Ingest:close",
    "Voices:close",
    "Guild:close",
    "RocketRide:close",
    "FalkorDB:close",
    "LaserData:close",
  ]);
});

test("Pipeline skips a frame while MiniMax vision is already in flight", async () => {
  const visionGate = deferred();
  const harness = createHarness();
  let calls = 0;
  harness.factories.perceiver = () => ({
    async label() {
      calls += 1;
      if (calls === 1) {
        await visionGate.promise;
        return { scene: "arena", objects: [], events: [] };
      }
      return null;
    },
  });
  const pipeline = new Pipeline(config, harness.factories);
  await pipeline.start();
  const run = pipeline.run;

  run.lastLabel = 0;
  const firstFrame = pipeline.handleFrame(Buffer.from("first"), run);
  await new Promise((resolve) => setImmediate(resolve));
  run.lastLabel = 0;
  await pipeline.handleFrame(Buffer.from("second"), run);

  assert.equal(pipeline.state, "running");
  assert.equal(calls, 2);
  visionGate.resolve();
  await firstFrame;
  await pipeline.stop();
});

test("Concurrent Pipeline starts share one readiness sequence", async () => {
  const gate = deferred();
  const { factories, log } = createHarness({ connectGate: { service: "LaserData", gate } });
  const pipeline = new Pipeline(config, factories);

  const first = pipeline.start();
  const second = pipeline.start();
  assert.equal(second, first);
  gate.resolve();
  await first;

  assert.equal(log.filter((entry) => entry === "LaserData:connect").length, 1);
  await pipeline.stop();
});
