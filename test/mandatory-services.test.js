const assert = require("node:assert/strict");
const test = require("node:test");
const { Actions } = require("../src/actions");
const { Memory } = require("../src/memory");
const { SignalStream } = require("../src/signals");

const config = {
  laserData: {
    connectionString: "token@laser.example",
    stream: "humanharness-live",
    topic: "signals",
  },
  falkor: {
    url: "rediss://falkor.example:6379",
    graph: "humanharness",
    password: "password",
  },
  rocketRideApiKey: "rr_test",
  rocketRideModel: "MiniMax-M2.7",
  minimax: { apiKey: "minimax_test", apiHost: "https://api.minimax.io" },
};

test("LaserData is required and publishes remotely before local delivery", async () => {
  await assert.rejects(
    () => new SignalStream({ laserData: { connectionString: "" } }).connect(),
    (error) => error.service === "LaserData" && /required/.test(error.message),
  );

  const order = [];
  let delivered;
  const topic = {
    ensure: async () => order.push("ensure"),
    publish: () => ({
      json: (event) => ({
        send: async () => {
          delivered = event;
          order.push("remote");
        },
      }),
    }),
  };
  const laser = {
    stream: () => ({ topic: () => topic }),
    close: async () => order.push("close"),
  };
  const signals = new SignalStream(config, {
    loadLaser: async () => ({ Laser: { connect: async () => laser } }),
  });
  signals.on("signal", () => order.push("local"));

  assert.match(await signals.connect(), /^laserdata/);
  const event = await signals.publish("speech", { text: "hello" });

  assert.equal(delivered, event);
  assert.deepEqual(order.slice(-2), ["remote", "local"]);
  await signals.close();
});

test("LaserData timeout closes a socket stalled during topic readiness", async () => {
  let closeCount = 0;
  const topic = {
    ensure: async () => new Promise(() => {}),
  };
  const laser = {
    stream: () => ({ topic: () => topic }),
    close: async () => { closeCount += 1; },
  };
  const signals = new SignalStream(config, {
    loadLaser: async () => ({ Laser: { connect: async () => laser } }),
    connectTimeoutMs: 10,
  });

  await assert.rejects(
    () => signals.connect(),
    (error) => error.service === "LaserData" && /timed out/.test(error.message),
  );
  assert.equal(closeCount, 1);
});

test("FalkorDB is required for writes and recall", async () => {
  await assert.rejects(
    () => new Memory({ falkor: { url: "", connectionString: "" } }).connect(),
    (error) => error.service === "FalkorDB" && /required/.test(error.message),
  );

  const queries = [];
  const graph = {
    query: async (query, options) => {
      queries.push({ query, options });
      if (query.startsWith("MATCH (s:Signal)")) {
        return { data: [{ kind: "labels", scene: "arena", text: "", ts: "now" }] };
      }
      return { data: [] };
    },
  };
  const db = { selectGraph: () => graph, close: async () => {} };
  const memory = new Memory(config, {
    loadFalkor: () => ({ FalkorDB: { connect: async () => db } }),
  });

  assert.match(await memory.connect(), /^falkordb/);
  await memory.record({
    kind: "labels",
    scene: "arena",
    objects: ["boss"],
    events: ["spawned"],
    ts: "now",
  });
  const recalled = await memory.recall(["boss"]);

  assert.equal(recalled[0].scene, "arena");
  assert.ok(queries.some(({ query }) => query.startsWith("CREATE (:Signal")));
  assert.ok(queries.some(({ query }) => query.startsWith("MATCH (s:Signal)")));
  await memory.close();
  await assert.rejects(() => memory.record({}), /FalkorDB: graph is not connected/);
});

test("FalkorDB timeout bounds the health query and closes the database", async () => {
  let closeCount = 0;
  const db = {
    selectGraph: () => ({ query: async () => new Promise(() => {}) }),
    close: async () => { closeCount += 1; },
  };
  const memory = new Memory(config, {
    loadFalkor: () => ({ FalkorDB: { connect: async () => db } }),
    connectTimeoutMs: 10,
  });

  await assert.rejects(
    () => memory.connect(),
    (error) => error.service === "FalkorDB" && /timed out/.test(error.message),
  );
  assert.equal(closeCount, 1);
});

test("RocketRide is required and empty pipeline answers are blockers", async () => {
  await assert.rejects(
    () => new Actions({ ...config, rocketRideApiKey: "" }).connect(),
    (error) => error.service === "RocketRide" && /required/.test(error.message),
  );

  let answers = ["route result"];
  const statuses = [
    { state: 1, serviceUp: false },
    { state: 2, serviceUp: false },
    { state: 3, serviceUp: true },
  ];
  let constructorConfig;
  let useConfig;
  class RocketRideClient {
    constructor(value) { constructorConfig = value; }
    async connect() {}
    async use(value) { useConfig = value; return { token: "task-token" }; }
    async getTaskStatus() { return statuses.shift(); }
    async send() { return { answers }; }
    async terminate() {}
    async disconnect() {}
  }
  const actions = new Actions(config, {
    loadRocketRide: () => ({ RocketRideClient, CONST_DEFAULT_WEB_CLOUD: "wss://rocket" }),
    readinessPollMs: 0,
  });

  assert.match(await actions.connect(), /^rocketride/);
  assert.equal(constructorConfig.requestTimeout, 15000);
  assert.equal(useConfig.useExisting, false);
  assert.equal(useConfig.ttl, 3600);
  assert.match(useConfig.token, /^[0-9a-f-]{36}$/);
  assert.deepEqual((await actions.lookup("next route")).answers, ["route result"]);
  answers = [];
  await assert.rejects(
    () => actions.lookup("next route"),
    (error) => error.service === "RocketRide" && /no answers/.test(error.message),
  );
  await actions.stop();
});

test("RocketRide rejects a task that exits before it becomes ready", async () => {
  const calls = [];
  class RocketRideClient {
    async connect() { calls.push("connect"); }
    async use() { calls.push("use"); return { token: "task-token" }; }
    async getTaskStatus() {
      return {
        state: 5,
        serviceUp: false,
        completed: true,
        errors: ["pipeline validation failed"],
        exitCode: 1,
      };
    }
    async terminate(token) { calls.push(`terminate:${token}`); }
    async disconnect() { calls.push("disconnect"); }
  }
  const actions = new Actions(config, {
    loadRocketRide: () => ({ RocketRideClient, CONST_DEFAULT_WEB_CLOUD: "wss://rocket" }),
    readinessPollMs: 0,
  });

  await assert.rejects(
    () => actions.connect(),
    (error) => error.service === "RocketRide" && /pipeline validation failed/.test(error.message),
  );
  assert.deepEqual(calls, ["connect", "use", "terminate:task-token", "disconnect"]);
});

test("RocketRide timeout terminates and disconnects a stalled readiness request", async () => {
  const calls = [];
  class RocketRideClient {
    async connect() { calls.push("connect"); }
    async use() { calls.push("use"); return { token: "task-token" }; }
    async getTaskStatus() { return new Promise(() => {}); }
    async terminate(token) { calls.push(`terminate:${token}`); }
    async disconnect() { calls.push("disconnect"); }
  }
  const actions = new Actions(config, {
    loadRocketRide: () => ({ RocketRideClient, CONST_DEFAULT_WEB_CLOUD: "wss://rocket" }),
    connectTimeoutMs: 10,
    cleanupTimeoutMs: 10,
    readinessPollMs: 0,
  });

  await assert.rejects(
    () => actions.connect(),
    (error) => error.service === "RocketRide" && /timed out/.test(error.message),
  );
  assert.deepEqual(calls, ["connect", "use", "terminate:task-token", "disconnect"]);
});
