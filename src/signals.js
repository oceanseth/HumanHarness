const { EventEmitter } = require("events");

const CONNECT_TIMEOUT_MS = 10000;

// The SDK retries the initial handshake forever by default, so an unreachable
// deployment would hang pipeline start. Bound the retries, and time the whole
// handshake out on top of that.
const withBoundedRetries = (target) =>
  target.includes("reconnection_retries=")
    ? target
    : `${target}${target.includes("?") ? "&" : "?"}reconnection_retries=3&reconnection_interval=1s`;

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`connect timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

// LaserData signal stream: labeled frames + speech events enter the system
// only through here. The local bus always carries them; with a connection
// string they are also published to a LaserData topic.
//
// LaserData is Apache Iggy over VSR, not a REST ingest — publishing goes
// through the Laser SDK, which ships ESM-only, so it is pulled in with a
// dynamic import from this CommonJS module. Without a connection string the
// local bus alone carries the events and the loop still runs.
class SignalStream extends EventEmitter {
  constructor(config) {
    super();
    this.config = config.laserData;
    this.laser = null;
    this.topic = null;
    this.mode = "local bus";
  }

  async connect() {
    if (!this.config.connectionString) return this.mode;
    const open = async () => {
      const { Laser } = await import("@laserdata/laser-sdk");
      const laser = await Laser.connect(withBoundedRetries(this.config.connectionString));
      const topic = laser.stream(this.config.stream).topic(this.config.topic);
      // one partition: the crew reads this as a single ordered feed, and Iggy
      // only orders within a partition.
      await topic.ensure(1);
      return { laser, topic };
    };

    const opening = open();
    try {
      const opened = await withTimeout(opening, CONNECT_TIMEOUT_MS);
      this.laser = opened.laser;
      this.topic = opened.topic;
      this.mode = `laserdata (${this.config.stream}/${this.config.topic})`;
    } catch (err) {
      this.laser = null;
      this.topic = null;
      this.mode = `local bus (LaserData unavailable: ${err.message})`;
      // a handshake that lands after the timeout would otherwise leak a socket
      opening.then((late) => late.laser.close()).catch(() => {});
    }
    return this.mode;
  }

  async publish(kind, payload) {
    const event = { kind, stream: this.config.stream, ts: new Date().toISOString(), ...payload };
    this.emit("signal", event);
    if (this.topic) {
      try {
        await this.topic.publish().json(event).send();
      } catch (err) {
        this.emit("signal", { kind: "laserdata-error", error: err.message });
      }
    }
    return event;
  }

  async close() {
    if (!this.laser) return;
    try {
      await this.laser.close();
    } catch {
      // connection already gone; nothing to release
    }
    this.laser = null;
    this.topic = null;
  }
}

module.exports = { SignalStream };
