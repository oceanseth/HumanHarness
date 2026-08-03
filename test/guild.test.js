const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { GuildClient, normalizeGuildOutput } = require("../src/guild");
const { Crew } = require("../src/crew");

const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? "OK" : "Error",
  json: async () => payload,
});

test("GuildClient invokes an API trigger with Basic auth and returns runtime output", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return response({ id: "session-1" });
    return response({
      items: [
        {
          id: "event-1",
          type: "runtime_done",
          content: {
            persona: "historian",
            rationale: "A remembered pattern is relevant.",
          },
        },
      ],
    });
  };
  const client = new GuildClient(
    {
      apiKey: "key-id:key-secret",
      owner: "oceanseth",
      workspace: "human-harness",
      pollIntervalMs: 0,
    },
    { fetch, sleep: async () => {} },
  );

  const result = await client.route({ trigger: "tick", goal: "win", signals: [], memories: [] });

  assert.deepEqual(result, {
    persona: "historian",
    routingReason: "A remembered pattern is relevant.",
  });
  assert.equal(calls[0].url, "https://app.guild.ai/api/workspaces/oceanseth/human-harness/sessions");
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from("key-id:key-secret").toString("base64")}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    session_type: "api_trigger",
    agent_input: { trigger: "tick", goal: "win", signals: [], memories: [] },
  });
});

test("GuildClient reports the documented trigger-key format", () => {
  const client = new GuildClient({ apiKey: "user-session-token", owner: "owner", workspace: "workspace" });
  assert.match(client.configurationError(), /<api_key_id>:<api_key_secret>/);
  assert.equal(client.isConfigured(), false);

  for (const apiKey of [":secret", "key-id:"]) {
    assert.match(
      new GuildClient({ apiKey, owner: "owner", workspace: "workspace" }).configurationError(),
      /<api_key_id>:<api_key_secret>/,
    );
  }
});

test("GuildClient accepts an array event response without undocumented cursor parameters", async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return response({ id: "session-2" });
    return response([
      {
        id: "event-2",
        type: "runtime_done",
        content: {
          output: {
            persona: "strategist",
            rationale: "The user asked for tactics.",
          },
        },
      },
    ]);
  };
  const client = new GuildClient(
    {
      apiKey: "key-id:key-secret",
      owner: "oceanseth",
      workspace: "human-harness",
      pollIntervalMs: 0,
    },
    { fetch, sleep: async () => {} },
  );

  const result = await client.route({ trigger: "tick", goal: "win", signals: [], memories: [] });

  assert.equal(result.persona, "strategist");
  assert.equal(result.routingReason, "The user asked for tactics.");
  assert.match(calls[1].url, /events\?limit=1000$/);
});

test("normalizeGuildOutput accepts Guild runtime_done JSON strings", () => {
  assert.deepEqual(
    normalizeGuildOutput('{"persona":"scout","rationale":"The next area needs reconnaissance."}'),
    { persona: "scout", routingReason: "The next area needs reconnaissance." },
  );
});

const makeCrew = () => {
  const memory = {
    recall: async () => [],
    record: async () => {},
  };
  const actions = { lookup: async () => null };
  const crew = new Crew(
    {
      minimax: {},
      crewModel: "MiniMax-M2.7",
      guild: { apiKey: "key-id:key-secret", owner: "owner", workspace: "workspace" },
    },
    memory,
    actions,
  );
  crew.observe({ scene: "boss arena", objects: ["boss"], events: ["victory"] });
  return crew;
};

test("Crew uses Guild for the persona and MiniMax for the spoken line", async () => {
  const crew = makeCrew();
  assert.equal(crew.routingStatus(), "guild");
  crew.guildClient.route = async () => ({
    persona: "hypecaster",
    routingReason: "A victory event needs energy.",
  });
  crew.minimaxClient.chat = async ({ system }) => {
    assert.match(system, /Guild selected hypecaster/);
    return '{"persona":"strategist","line":"That was enormous!","lookup":null,"remember":[]}';
  };

  const result = await crew.speak("tick");

  assert.equal(result.persona, "hypecaster");
  assert.equal(result.line, "That was enormous!");
  assert.equal(result.routingSource, "guild");
  assert.equal(result.routingReason, "A victory event needs energy.");
});

test("Crew falls back to MiniMax when Guild is unavailable", async () => {
  const crew = makeCrew();
  crew.guildClient.route = async () => {
    throw new Error("service unavailable");
  };
  crew.minimaxClient.chat = async () =>
    '{"persona":"strategist","line":"Dodge left.","lookup":null,"remember":[]}';

  const result = await crew.speak("tick");

  assert.equal(result.line, "Dodge left.");
  assert.equal(result.routingSource, "minimax-fallback");
  assert.equal(result.routingWarning, "service unavailable");
});

test("Crew exposes an incomplete Guild setup as a MiniMax fallback", () => {
  const crew = makeCrew();
  crew.guildClient.apiKey = "user-session-token";

  assert.match(crew.routingStatus(), /^minimax fallback/);
  assert.match(crew.routingStatus(), /<api_key_id>:<api_key_secret>/);
});

test("Guild runtime routing never invokes a non-MiniMax LLM", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "guild-agent", "agent.ts"), "utf8");

  assert.doesNotMatch(source, /task\.llm|generateText|anthropic/i);
});
