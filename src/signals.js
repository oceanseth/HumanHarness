const { EventEmitter } = require("events");

// LaserData signal stream: labeled frames + speech events enter the system
// only through here. With an API key, events are also published to the
// LaserData ingest endpoint; without one, the local bus alone carries them.
class SignalStream extends EventEmitter {
  constructor(config) {
    super();
    this.config = config.laserData;
  }

  async publish(kind, payload) {
    const event = { kind, stream: this.config.stream, ts: new Date().toISOString(), ...payload };
    this.emit("signal", event);
    if (this.config.apiKey && this.config.endpoint) {
      try {
        await fetch(this.config.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(event),
        });
      } catch (err) {
        this.emit("signal", { kind: "laserdata-error", error: err.message });
      }
    }
    return event;
  }
}

module.exports = { SignalStream };
