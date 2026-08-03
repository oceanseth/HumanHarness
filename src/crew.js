const Anthropic = require("@anthropic-ai/sdk");

// Guild.ai collaboration layer: routes each moment to the right persona and
// produces their line. Locally this is one Claude call that picks the persona
// and writes the commentary; with a GUILD_API_KEY the same decision would be
// delegated to Guild's router (TODO once endpoint docs are in hand).
// Voices are masky.ai personas; without a key the renderer speaks lines with
// browser speechSynthesis using per-persona pitch/rate.

const PERSONAS = {
  strategist: "Tactics toward the stated goal. Terse, precise, actionable.",
  historian: "Memory callbacks — connects what's happening to what the crew has seen before.",
  hypecaster: "Color commentary, energy, celebration. Short and loud.",
  scout: "What's ahead — requests lookups for upcoming areas, bosses, schedules.",
};

const CREW_SCHEMA = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      persona: { type: "string", enum: Object.keys(PERSONAS) },
      line: { type: "string", description: "The spoken commentary line, <= 2 sentences" },
      lookup: {
        type: ["string", "null"],
        description: "External lookup the Scout wants (null if none)",
      },
      remember: {
        type: "array",
        items: { type: "string" },
        description: "Facts worth writing to graph memory",
      },
    },
    required: ["persona", "line", "lookup", "remember"],
    additionalProperties: false,
  },
};

class Crew {
  constructor(config, memory, actions) {
    this.config = config;
    this.memory = memory;
    this.actions = actions;
    this.client = new Anthropic();
    this.goal = "";
    this.recentSignals = [];
    this.busy = false;
  }

  setGoal(goal) {
    this.goal = goal;
  }

  observe(signal) {
    this.recentSignals.push(signal);
    if (this.recentSignals.length > 20) this.recentSignals.shift();
  }

  // Produce the next commentary line. `trigger` is "tick" or a user utterance.
  async speak(trigger) {
    if (this.busy || this.recentSignals.length === 0) return null;
    this.busy = true;
    try {
      const latest = this.recentSignals[this.recentSignals.length - 1];
      const terms = [...(latest.objects || []), ...(latest.events || [])]
        .flatMap((s) => s.toLowerCase().split(/\W+/))
        .filter((w) => w.length > 3);
      const memories = await this.memory.recall(terms);

      const system = [
        "You are the HumanHarness crew: four masky.ai personas co-casting a live feed. The human drives; you pull alongside.",
        ...Object.entries(PERSONAS).map(([k, v]) => `- ${k}: ${v}`),
        "Pick the ONE persona whose voice fits this moment and write their line.",
        this.goal ? `The human's stated goal: ${this.goal}` : "No goal stated yet.",
      ].join("\n");

      const user = [
        `Recent signals (oldest first):\n${this.recentSignals.map((s) => JSON.stringify(s)).join("\n")}`,
        memories.length ? `Graph memory recall:\n${memories.map((m) => JSON.stringify(m)).join("\n")}` : "No relevant memories.",
        trigger === "tick" ? "React to the current moment." : `The human just said: "${trigger}". Respond to them.`,
      ].join("\n\n");

      const response = await this.client.messages.create({
        model: this.config.crewModel,
        max_tokens: 1024,
        output_config: { format: CREW_SCHEMA },
        system,
        messages: [{ role: "user", content: user }],
      });
      if (response.stop_reason === "refusal") return null;
      const text = response.content.find((b) => b.type === "text");
      if (!text) return null;
      const out = JSON.parse(text.text);

      for (const fact of out.remember || []) {
        await this.memory.record({ scene: fact, objects: [], events: [fact], ts: new Date().toISOString() });
      }
      if (out.lookup) {
        out.lookupResult = await this.actions.lookup(out.lookup);
      }
      return out;
    } catch (err) {
      return { persona: "strategist", line: "", error: err.message };
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Crew, PERSONAS };
