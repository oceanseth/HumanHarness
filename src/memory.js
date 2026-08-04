// FalkorDB graph memory: every accepted LaserData signal is persisted here
// before it becomes crew context. A missing or unhealthy graph blocks the
// pipeline; there is no in-process substitute for the mandatory memory stage.
//
// Uses the managed cloud instance via the redis:// or rediss:// connection
// string shown by its Connect page.
// Connects with a 10s timeout — the instance may be provisioning, sleeping
// (free tier: stops after 1 day idle, deleted after 7), or unavailable.
const { asDependencyError } = require("./dependency-error");

const CONNECT_TIMEOUT_MS = 10_000;

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("connection timed out (instance may be provisioning or sleeping)")),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

class Memory {
  constructor(config, options = {}) {
    this.config = config.falkor;
    this.loadFalkor = options.loadFalkor || (() => require("falkordb"));
    this.connectTimeoutMs = options.connectTimeoutMs || CONNECT_TIMEOUT_MS;
    this.db = null;
    this.graph = null;
    this.mode = "disconnected";
  }

  // Connect to the managed FalkorDB instance and prove the graph is queryable.
  async connect() {
    const url = this.config.url || this.config.connectionString || "";
    if (!url) {
      throw asDependencyError("FalkorDB", new Error("FALKORDB_URL is required"));
    }

    let host = "unknown";
    try {
      host = new URL(url).hostname;
    } catch {
      // rediss:// sometimes confuses the URL parser; extract manually
      const m = url.match(/@([^:/]+)/);
      if (m) host = m[1];
    }

    try {
      const { FalkorDB } = this.loadFalkor();
      let provisionalDb = null;
      let cancelled = false;
      let closed = false;
      const closeProvisional = async () => {
        if (!provisionalDb || closed) return;
        closed = true;
        await provisionalDb.close().catch(() => {});
      };
      const opening = (async () => {
        provisionalDb = await FalkorDB.connect({
          url,
          password: this.config.password || undefined,
        });
        if (cancelled) {
          await closeProvisional();
          throw new Error("connection cancelled after timeout");
        }
        const graph = provisionalDb.selectGraph(this.config.graph);
        await graph.query("RETURN 1");
        if (cancelled) {
          await closeProvisional();
          throw new Error("health check cancelled after timeout");
        }
        return { db: provisionalDb, graph };
      })();
      let opened;
      try {
        opened = await withTimeout(opening, this.connectTimeoutMs);
      } catch (error) {
        cancelled = true;
        await closeProvisional();
        opening.then((late) => late.db.close().catch(() => {})).catch(() => {});
        throw error;
      }
      this.db = opened.db;
      this.graph = opened.graph;
      this.mode = `falkordb (${host}/${this.config.graph})`;
    } catch (err) {
      if (this.db) {
        try {
          await this.db.close();
        } catch {
          // The failed connection has nothing else to release.
        }
      }
      this.db = null;
      this.graph = null;
      this.mode = "disconnected";
      throw asDependencyError("FalkorDB", err);
    }
    return this.mode;
  }

  async record(obs) {
    if (!this.graph) {
      throw asDependencyError("FalkorDB", new Error("graph is not connected"));
    }
    try {
      const searchText = [
        obs.scene || "",
        obs.text || "",
        ...(obs.objects || []),
        ...(obs.events || []),
      ].join(" ");
      await this.graph.query(
        "CREATE (:Signal {kind: $kind, scene: $scene, text: $text, searchText: $searchText, ts: $ts})",
        {
          params: {
            kind: obs.kind || "unknown",
            scene: obs.scene || "",
            text: obs.text || "",
            searchText,
            ts: obs.ts || "",
          },
        },
      );
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
    } catch (err) {
      throw asDependencyError("FalkorDB", err);
    }
  }

  async recall(terms, limit = 5) {
    if (!this.graph) {
      throw asDependencyError("FalkorDB", new Error("graph is not connected"));
    }
    if (!terms.length) return [];
    try {
      const res = await this.graph.query(
        "MATCH (s:Signal) WHERE any(term IN $terms WHERE toLower(s.searchText) CONTAINS term) RETURN s.kind AS kind, s.scene AS scene, s.text AS text, s.ts AS ts ORDER BY s.ts DESC LIMIT $limit",
        { params: { terms: terms.map((term) => term.toLowerCase()), limit } },
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      throw asDependencyError("FalkorDB", err);
    }
  }

  async close() {
    const db = this.db;
    this.db = null;
    this.graph = null;
    this.mode = "disconnected";
    if (!db) return;
    try {
      await db.close();
    } catch {
      // already disconnected
    }
  }
}

module.exports = { Memory };
