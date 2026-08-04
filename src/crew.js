const { MiniMaxClient, parseJsonResponse } = require("./minimax");
const { GuildClient } = require("./guild");

// Guild.ai routes each moment to the right persona. MiniMax writes that
// persona's line locally so Guild never falls through to a non-MiniMax LLM.
// If the Guild API trigger is unavailable, MiniMax also chooses the persona.
// Voices are masky.ai personas; without a key the renderer speaks lines with
// browser speechSynthesis using per-persona pitch/rate.

const PERSONAS = {
  strategist: "Tactics toward the stated goal. Terse, precise, actionable.",
  historian: "Memory callbacks — connects what's happening to what the crew has seen before.",
  hypecaster: "Color commentary, energy, celebration. Short and loud.",
  scout: "What's ahead — requests lookups for upcoming areas, bosses, schedules.",
};

class Crew {
  constructor(config, memory, actions) {
    this.config = config;
    this.memory = memory;
    this.actions = actions;
    this.minimaxClient = new MiniMaxClient(config.minimax);
    this.guildClient = new GuildClient(config.guild);
    this.goal = "";
    this.recentSignals = [];
    this.busy = false;
  }

  setGoal(goal) {
    this.goal = goal;
  }

  routingStatus() {
    if (this.guildClient.isConfigured()) return "guild";
    if (!this.config.guild?.apiKey) return "minimax";
    return `minimax fallback (${this.guildClient.configurationError()})`;
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

      let route;
      let guildError = null;
      if (this.guildClient.isConfigured()) {
        try {
          route = await this.guildClient.route({
            trigger,
            goal: this.goal,
            signals: this.recentSignals,
            memories,
          });
        } catch (err) {
          guildError = err.message;
        }
      } else if (this.config.guild?.apiKey) {
        guildError = this.guildClient.configurationError();
      }

      const out = await this.speakLocally(trigger, memories, route?.persona);
      if (!out) return null;
      if (route?.persona) out.persona = route.persona;
      if (!PERSONAS[out.persona]) out.persona = "strategist";
      out.line = String(out.line || "");
      out.lookup = out.lookup ? String(out.lookup) : null;
      out.remember = Array.isArray(out.remember) ? out.remember.map(String) : [];
      out.routingSource = guildError
        ? "minimax-fallback"
        : route
          ? "guild"
          : "minimax";
      if (route?.routingReason) out.routingReason = route.routingReason;
      if (guildError) out.routingWarning = guildError;

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

  async speakLocally(trigger, memories, routedPersona = null) {
    const system = [
      "You are the HumanHarness crew: four masky.ai personas co-casting a live feed. The human drives; you pull alongside.",
      ...Object.entries(PERSONAS).map(([k, v]) => `- ${k}: ${v}`),
      routedPersona
        ? `Guild selected ${routedPersona}. Use exactly that persona and write their line.`
        : "Pick the ONE persona whose voice fits this moment and write their line.",
      "Return JSON only, with no markdown, using exactly this shape:",
      '{"persona":"strategist|historian|hypecaster|scout","line":"at most two sentences","lookup":null,"remember":[]}',
      this.goal ? `The human's stated goal: ${this.goal}` : "No goal stated yet.",
    ].join("\n");

    const user = [
      `Recent signals (oldest first):\n${this.recentSignals.map((s) => JSON.stringify(s)).join("\n")}`,
      memories.length
        ? `Graph memory recall:\n${memories.map((m) => JSON.stringify(m)).join("\n")}`
        : "No relevant memories.",
      trigger === "tick"
        ? "React to the current moment."
        : `The human just said: "${trigger}". Respond to them.`,
    ].join("\n\n");

    const text = await this.minimaxClient.chat({
      model: this.config.crewModel,
      maxTokens: 1024,
      system,
      user,
    });
    if (!text) return null;
    return parseJsonResponse(text);
  }
}

module.exports = { Crew, PERSONAS };
