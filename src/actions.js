// RocketRide.ai action layer: turns "what's happening + what we remember"
// into external actions (wiki lookups, map queries, strategy tools).
// Without an API key this is a mock: it records the intent and returns
// nothing, so the crew still runs but performs no external calls.
class Actions {
  constructor(config) {
    this.apiKey = config.rocketRideApiKey;
    this.log = [];
  }

  async lookup(intent) {
    this.log.push({ intent, ts: new Date().toISOString() });
    if (!this.apiKey) {
      return { mock: true, note: `RocketRide mock — would look up: ${intent}` };
    }
    // TODO: wire the real RocketRide.ai orchestration API once credentials and
    // endpoint docs are in hand. Shape: POST intent -> orchestrated result.
    return { mock: true, note: `RocketRide key present but endpoint not yet wired — intent: ${intent}` };
  }
}

module.exports = { Actions };
