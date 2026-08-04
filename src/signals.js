const { EventEmitter } = require("events");
const { asDependencyError } = require("./dependency-error");

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
// only through a confirmed remote publish. Local listeners run afterward, so
// downstream state never advances past a failed LaserData write.
//
// LaserData is Apache Iggy over VSR, not a REST ingest — publishing goes
// through the Laser SDK, which ships ESM-only, so it is pulled in with a
// dynamic import from this CommonJS module.
class SignalStream extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config.laserData;
    this.loadLaser = options.loadLaser || (() => import("@laserdata/laser-sdk"));
    this.connectTimeoutMs = options.connectTimeoutMs || CONNECT_TIMEOUT_MS;
    this.laser = null;
    this.topic = null;
    this.mode = "disconnected";
  }

  async connect() {
    if (!this.config.connectionString) {
      throw asDependencyError("LaserData", new Error("LASER_CONNECTION_STRING is required"));
    }
    let provisionalLaser = null;
    let cancelled = false;
    let closed = false;
    const closeProvisional = async () => {
      if (!provisionalLaser || closed) return;
      closed = true;
      await provisionalLaser.close().catch(() => {});
    };
    const open = async () => {
      const { Laser } = await this.loadLaser();
      const laser = await Laser.connect(withBoundedRetries(this.config.connectionString));
      provisionalLaser = laser;
      if (cancelled) {
        await closeProvisional();
        throw new Error("connect cancelled after timeout");
      }
      try {
        const topic = laser.stream(this.config.stream).topic(this.config.topic);
        // one partition: the crew reads this as a single ordered feed, and Iggy
        // only orders within a partition.
        await topic.ensure(1);
        if (cancelled) {
          await closeProvisional();
          throw new Error("topic readiness cancelled after timeout");
        }
        return { laser, topic };
      } catch (error) {
        await closeProvisional();
        throw error;
      }
    };

    const opening = open();
    try {
      const opened = await withTimeout(opening, this.connectTimeoutMs);
      this.laser = opened.laser;
      this.topic = opened.topic;
      this.mode = `laserdata (${this.config.stream}/${this.config.topic})`;
    } catch (err) {
      cancelled = true;
      await closeProvisional();
      this.laser = null;
      this.topic = null;
      this.mode = "disconnected";
      // a handshake that lands after the timeout would otherwise leak a socket
      opening.then((late) => late.laser.close().catch(() => {})).catch(() => {});
      throw asDependencyError("LaserData", err);
    }
    return this.mode;
  }

  async publish(kind, payload) {
    if (!this.topic) {
      throw asDependencyError("LaserData", new Error("signal stream is not connected"));
    }
    const event = { kind, stream: this.config.stream, ts: new Date().toISOString(), ...payload };
    try {
      await this.topic.publish().json(event).send();
    } catch (err) {
      throw asDependencyError("LaserData", err);
    }
    this.emit("signal", event);
    return event;
  }

  async close() {
    const laser = this.laser;
    this.laser = null;
    this.topic = null;
    this.mode = "disconnected";
    if (!laser) return;
    try {
      await laser.close();
    } catch {
      // connection already gone; nothing to release
    }
  }
}

module.exports = { SignalStream };
