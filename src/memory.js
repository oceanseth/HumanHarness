// FalkorDB graph memory: entities the crew has seen and relationships between
// them, persisted across sessions. Falls back to an in-process graph when
// FalkorDB is unreachable, so the loop always runs.
//
// Uses the managed cloud instance via rediss:// (TLS) connection string.
// Connects with a 10s timeout — the instance may be provisioning, sleeping
// (free tier: stops after 1 day idle, deleted after 7), or unavailable.
// Startup never depends on FalkorDB; the in-memory fallback always serves.

const CONNECT_TIMEOUT_MS = 10_000;

class InMemoryGraph {
  constructor() {
    this.observations = []; // { scene, objects, events, ts }
  }
  async record(obs) {
    this.observations.push(obs);
    if (this.observations.length > 500) this.observations.shift();
  }
  // Naive recall: past observations sharing an object/event term with the query.
  async recall(terms, limit = 5) {
    const t = terms.map((s) => s.toLowerCase());
    return this.observations
      .filter((o) =>
        [...(o.objects || []), ...(o.events || []), o.scene || ""]
          .join(" ").toLowerCase()
          .split(/\W+/)
          .some((w) => w && t.includes(w)),
      )
      .slice(-limit);
  }
}

class Memory {
  constructor(config) {
    this.config = config.falkor;
    this.fallback = new InMemoryGraph();
    this.graph = null;
    this.mode = "in-memory";
  }

  // Connect to the managed FalkorDB instance. Raced against a timeout so
  // pipeline startup is never blocked by a provisioning or sleeping instance.
  // Returns a status string for the UI log.
  async connect() {
    if (!this.config.url && !this.config.connectionString) return this.mode;

    // Support both FALKORDB_URL (compact) and FALKORDB_CONNECTION_STRING.
    const url = this.config.url || this.config.connectionString || "";
    if (!url) return this.mode;

    let host = "unknown";
    try {
      host = new URL(url).hostname;
    } catch {
      // rediss:// sometimes confuses the URL parser; extract manually
      const m = url.match(/@([^:/]+)/);
      if (m) host = m[1];
    }

    try {
      const { FalkorDB } = require("falkordb");

      const connect = FalkorDB.connect({ url });
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("connection timed out (instance may be provisioning or sleeping)")), CONNECT_TIMEOUT_MS),
      );

      const db = await Promise.race([connect, timeout]);
      this.graph = db.selectGraph(this.config.graph);

      await this.graph.query("RETURN 1");
      this.mode = `falkordb (${host}/${this.config.graph})`;
    } catch (err) {
      this.graph = null;
      this.mode = `in-memory (FalkorDB ${host}: ${err.message})`;
    }
    return this.mode;
  }

  async record(obs) {
    await this.fallback.record(obs);
    if (!this.graph) return;
    try {
      for (const name of obs.objects || []) {
        await this.graph.query(
          "MERGE (e:Entity {name: $name}) MERGE (s:Scene {desc: $scene}) MERGE (e)-[:SEEN_IN {ts: $ts}]->(s)",
          { params: { name, scene: obs.scene || "", ts: obs.ts || "" } },
        );
      }
      for (const ev of obs.events || []) {
        await this.graph.query(
          "MERGE (v:Event {desc: $ev}) MERGE (s:Scene {desc: $scene}) MERGE (v)-[:OCCURRED_IN {ts: $ts}]->(s)",
          { params: { ev, scene: obs.scene || "", ts: obs.ts || "" } },
        );
      }
    } catch {
      // graph write failures fall back silently; in-memory copy already has it
    }
  }

  async recall(terms, limit = 5) {
    if (this.graph) {
      try {
        const res = await this.graph.query(
          "MATCH (e:Entity)-[r:SEEN_IN]->(s:Scene) WHERE toLower(e.name) IN $terms RETURN e.name AS name, s.desc AS scene, r.ts AS ts ORDER BY r.ts DESC LIMIT $limit",
          { params: { terms: terms.map((t) => t.toLowerCase()), limit } },
        );
        if (res.data && res.data.length) return res.data;
      } catch {
        // fall through to in-memory recall
      }
    }
    return this.fallback.recall(terms, limit);
  }
}

module.exports = { Memory };
