# HumanHarness Guild agents

HumanHarness uses five separate Guild agent projects:

```text
API trigger
    │
    ▼
humanharness-router
    │  typed @guildai/<owner>~<agent>/tool call
    ├── humanharness-strategist
    ├── humanharness-historian
    ├── humanharness-hypecaster
    └── humanharness-scout
             │
             ▼
deterministic structured brief → Electron → local MiniMax commentary
```

Every directory containing an `agent.ts` file is the source for a separately
versioned Guild agent. The router scores the current moment, invokes exactly one
specialist through its published `/tool` sub-package, and returns the selected
persona plus that specialist's structured brief. The specialists do not write
spoken commentary and none of the five agents calls `task.llm`; MiniMax remains
the only commentary model and runs in the Electron process.

## Contracts

The router keeps the API-trigger input used by the desktop app:

```json
{
  "trigger": "tick or the user's utterance",
  "goal": "the current goal",
  "signals": [],
  "memories": []
}
```

Its result is additive to the original `{ "persona", "rationale" }` contract:

```json
{
  "persona": "scout",
  "specialist": "scout",
  "rationale": "deterministic routing explanation",
  "brief": {
    "persona": "scout",
    "decision": "reconnoiter",
    "priority": "normal",
    "summary": "structured planning summary",
    "evidence": [],
    "directives": [],
    "lookup": null
  }
}
```

The Electron client requires both `specialist` and `brief`. A legacy
persona-only router result is a hard Guild blocker.

## Deployment

These are the authenticated Guild projects for the `human-harness`
organization. Each directory contains its real `guild.json`, complete build
manifest, and source. All five agents are published at `1.0.0`; the router is
installed in the `human-harness/humanharness` workspace and has an active API
trigger.

The four specialists must be published before the router because its manifest
resolves their `^1.0.0` agent-tool packages:

```text
@guildai/human-harness~humanharness-strategist/tool
@guildai/human-harness~humanharness-historian/tool
@guildai/human-harness~humanharness-hypecaster/tool
@guildai/human-harness~humanharness-scout/tool
```

The API trigger credential is runtime configuration, not part of an agent
project. Guild returns it once as `<api_key_id>:<api_key_secret>`; the desktop
client sends it with HTTP Basic authentication.

## Verification

From the repository root:

```bash
npm install
npm run typecheck:guild
npm test
```

The checked-in declaration file under `types/` gives each published tool a
concrete input and output contract for local type-checking without copying
Guild's private runtime packages into the application. An authenticated Guild
build remains the authoritative validation for generated package exports and
state-machine compilation.

For an authenticated Guild build, log in and run the checked-in project itself:

```bash
npx --yes @guildai/cli@0.17.0 auth login
npx --yes @guildai/cli@0.17.0 workspace select human-harness/humanharness
```

For each specialist, run:

```bash
cd guild-agents/strategist
npm install
npm run build
npx --yes @guildai/cli@0.17.0 agent test --mode json
npx --yes @guildai/cli@0.17.0 agent save \
  --message "Update HumanHarness strategist" \
  --wait \
  --publish
```

Repeat for `historian`, `hypecaster`, and `scout`, then build and publish the
router last. Keep the top-level `"use agent"` directive; Guild requires
compilation for sub-agent calls.

```bash
cd guild-agents/router
npm install
npm run build
npx --yes @guildai/cli@0.17.0 agent test --mode json
npx --yes @guildai/cli@0.17.0 agent capabilities --mode json
npx --yes @guildai/cli@0.17.0 agent save \
  --message "Update HumanHarness multi-agent router" \
  --wait \
  --publish
```

After a new router version is published, update its existing workspace install.
The specialists remain independently runnable while the router reaches their
published versions through typed agent-tool dependencies.

The agent-to-agent pattern follows Guild's official
[Calling an Agent as a Tool](https://www.guild.ai/blog/engineering/guild-user-control-plane-tips-tricks#calling-an-agent-as-a-tool)
guidance and the compiled-agent requirements in
[Auto-managed state agents](https://docs.guild.ai/guide/coded-agents#compilation-required-for-sub-agents-and-service-hooks).
