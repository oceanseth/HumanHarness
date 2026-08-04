const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { GuildClient, normalizeGuildOutput } = require("../src/guild");
const { Crew } = require("../src/crew");

const PERSONAS = ["strategist", "historian", "hypecaster", "scout"];
const GUILD_AGENTS_DIR = path.join(__dirname, "..", "guild-agents");

const specialistBrief = (persona, overrides = {}) => ({
  persona,
  decision: "hold-course",
  priority: "normal",
  summary: `${persona} planning summary`,
  evidence: ["current signal"],
  directives: ["Use the structured decision"],
  lookup: null,
  ...overrides,
});

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

test("normalizeGuildOutput preserves a nested deterministic specialist brief", () => {
  const brief = specialistBrief("scout", {
    decision: "reconnoiter",
    lookup: "next objective after the gate",
  });

  assert.deepEqual(
    normalizeGuildOutput({
      output: JSON.stringify({
        output: {
          persona: "scout",
          specialist: "scout",
          rationale: "The route ahead needs reconnaissance.",
          brief,
        },
      }),
    }),
    {
      persona: "scout",
      routingReason: "The route ahead needs reconnaissance.",
      specialistBrief: brief,
    },
  );
});

test("normalizeGuildOutput rejects mismatched specialist results", () => {
  assert.throws(
    () => normalizeGuildOutput({
      persona: "scout",
      specialist: "historian",
      rationale: "bad dispatch",
      brief: specialistBrief("historian"),
    }),
    /does not match the dispatched specialist/,
  );
  assert.throws(
    () => normalizeGuildOutput({ persona: "unknown", rationale: "bad route" }),
    /unknown persona/,
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
  const brief = specialistBrief("hypecaster", {
    decision: "celebrate",
    priority: "high",
    directives: ["Call out the concrete victory"],
  });
  assert.equal(crew.routingStatus(), "guild");
  crew.guildClient.route = async () => ({
    persona: "hypecaster",
    routingReason: "A victory event needs energy.",
    specialistBrief: brief,
  });
  crew.minimaxClient.chat = async ({ system, user }) => {
    assert.match(system, /Guild selected hypecaster/);
    assert.match(system, /only model that writes the spoken commentary/);
    assert.match(user, /"decision":"celebrate"/);
    return '{"persona":"strategist","line":"That was enormous!","lookup":null,"remember":[]}';
  };

  const result = await crew.speak("tick");

  assert.equal(result.persona, "hypecaster");
  assert.equal(result.line, "That was enormous!");
  assert.equal(result.routingSource, "guild");
  assert.equal(result.routingReason, "A victory event needs energy.");
  assert.deepEqual(result.specialistBrief, brief);
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

test("Guild topology contains five distinct agent source entrypoints", () => {
  const expected = ["router", ...PERSONAS].sort();
  const entrypoints = fs.readdirSync(GUILD_AGENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(GUILD_AGENTS_DIR, entry.name, "agent.ts")))
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(entrypoints, expected);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "guild-agent")), false);

  const packageNames = new Set();
  for (const name of expected) {
    const directory = path.join(GUILD_AGENTS_DIR, name);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const source = fs.readFileSync(path.join(directory, "agent.ts"), "utf8");

    packageNames.add(manifest.name);
    assert.equal(manifest.name, `humanharness-${name}`);
    assert.match(source, /export default agent\s*\(/);
    assert.doesNotMatch(source, /task\.llm|generateText|anthropic|openai/i);
  }
  assert.equal(packageNames.size, 5);
});

const loadRouterForTest = () => {
  const source = fs.readFileSync(path.join(GUILD_AGENTS_DIR, "router", "agent.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const schema = {
    nullable() { return schema; },
  };
  const z = {
    array: () => schema,
    enum: () => schema,
    object: () => schema,
    string: () => schema,
    unknown: () => schema,
  };
  const compiledModule = { exports: {} };
  const requireForRouter = (specifier) => {
    if (specifier === "@guildai/agents-sdk") return { agent: (definition) => definition };
    if (specifier === "zod") return { z };
    if (/^@guildai\/oceanseth~humanharness-.+\/tool$/.test(specifier)) {
      return { toolType: "agent", specifier };
    }
    throw new Error(`Unexpected router import in test: ${specifier}`);
  };

  new Function("require", "module", "exports", compiled)(
    requireForRouter,
    compiledModule,
    compiledModule.exports,
  );
  return compiledModule.exports;
};

const loadSpecialistForTest = (persona) => {
  const source = fs.readFileSync(path.join(GUILD_AGENTS_DIR, persona, "agent.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const schema = {
    nullable() { return schema; },
  };
  const z = {
    array: () => schema,
    enum: () => schema,
    literal: () => schema,
    object: () => schema,
    string: () => schema,
    unknown: () => schema,
  };
  const compiledModule = { exports: {} };
  const requireForSpecialist = (specifier) => {
    if (specifier === "@guildai/agents-sdk") {
      return { agent: (definition) => definition, noTools: {} };
    }
    if (specifier === "zod") return { z };
    throw new Error(`Unexpected ${persona} import in test: ${specifier}`);
  };

  new Function("require", "module", "exports", compiled)(
    requireForSpecialist,
    compiledModule,
    compiledModule.exports,
  );
  return compiledModule.exports.default;
};

test("Guild specialists return repeatable structured decisions without an LLM", async () => {
  const input = {
    trigger: "remember the victory and check the next path",
    goal: "reach the arena safely",
    signals: [{ scene: "gate", objects: ["boss door"], events: ["victory", "path opened"] }],
    memories: [{ scene: "gate", outcome: "the north path was safe" }],
  };

  for (const persona of PERSONAS) {
    const definition = loadSpecialistForTest(persona);
    const first = await definition.run(input);
    const second = await definition.run(input);

    assert.deepEqual(second, first);
    assert.equal(first.persona, persona);
    assert.match(first.priority, /^(low|normal|high)$/);
    assert.equal(typeof first.decision, "string");
    assert.equal(typeof first.summary, "string");
    assert.ok(Array.isArray(first.evidence));
    assert.ok(Array.isArray(first.directives));
    assert.ok(first.lookup === null || typeof first.lookup === "string");
  }
});

test("Guild router executes the selected specialist implementation through task.tools", async () => {
  const { run } = loadRouterForTest();
  const specialists = Object.fromEntries(
    PERSONAS.map((persona) => [persona, loadSpecialistForTest(persona)]),
  );
  const cases = [
    {
      persona: "strategist",
      input: { trigger: "plan an approach", goal: "survive", signals: [], memories: [] },
    },
    {
      persona: "historian",
      input: { trigger: "remember the same pattern again", goal: "", signals: [], memories: ["last run"] },
    },
    {
      persona: "hypecaster",
      input: { trigger: "tick", goal: "", signals: [{ events: ["victory"] }], memories: [] },
    },
    {
      persona: "scout",
      input: { trigger: "tick", goal: "", signals: [{ events: ["next path"] }], memories: [] },
    },
    {
      persona: "scout",
      input: { trigger: "tick", goal: "map the next boss door", signals: [], memories: [] },
    },
  ];

  for (const scenario of cases) {
    const calls = [];
    const task = {
      tools: Object.fromEntries(PERSONAS.map((persona) => [
        persona,
        async (input) => {
          calls.push({ persona, input });
          return specialists[persona].run(input);
        },
      ])),
    };

    const result = await run(scenario.input, task);

    assert.deepEqual(calls, [{ persona: scenario.persona, input: scenario.input }]);
    assert.equal(result.persona, scenario.persona);
    assert.equal(result.specialist, scenario.persona);
    assert.equal(result.brief.persona, scenario.persona);
    assert.equal(typeof result.brief.decision, "string");
    assert.ok(result.brief.decision.length > 0);
  }
});

test("Guild router uses the published specialist tool packages", () => {
  const definition = loadRouterForTest().default;
  const source = fs.readFileSync(path.join(GUILD_AGENTS_DIR, "router", "agent.ts"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(GUILD_AGENTS_DIR, "router", "package.json"), "utf8"),
  );

  assert.match(source, /^"use agent"/);
  for (const persona of PERSONAS) {
    const packageName = `@guildai/oceanseth~humanharness-${persona}`;
    assert.equal(manifest.dependencies[packageName], "^1.0.0");
    assert.equal(definition.tools[persona].specifier, `${packageName}/tool`);
    assert.match(source, new RegExp(`from "${packageName}/tool"`));
    assert.match(source, new RegExp(`await task\\.tools\\.${persona}\\(input\\)`));
  }
});
