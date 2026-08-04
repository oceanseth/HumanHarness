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

Every directory containing an `agent.ts` file is an independently publishable
Guild project. The router scores the current moment, invokes exactly one
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

The Electron client still accepts a legacy result without `specialist` or
`brief`, so an older published router remains a safe fallback during rollout.

## Local verification

From the repository root:

```bash
npm install
npm run typecheck:guild
npm test
```

The checked-in declaration file under `types/` lets the repository type-check
against the documented SDK surface without copying Guild's private runtime
packages into the application. An authenticated Guild build remains the
authoritative validation for generated agent-tool types and state-machine
compilation.

## Publish order

Guild manages `guild.json`, the build scripts, SDK versions, and private npm
registry settings. Create one Guild CLI project per directory and retain those
generated scaffold files. Copy only the corresponding `agent.ts` into each
project; do not replace a scaffold's complete `package.json` or `tsconfig.json`
with the small repository manifests.

Use the Guild CLI explicitly so it is not confused with the unrelated GNU
`guild`/Guile executable that some systems provide:

```bash
npx --yes @guildai/cli@0.17.0 auth login
```

Publish the four specialists first. Repeat this flow for `strategist`,
`historian`, `hypecaster`, and `scout`:

```bash
mkdir humanharness-strategist
cd humanharness-strategist
npx --yes @guildai/cli@0.17.0 agent init \
  --name humanharness-strategist \
  --template AUTO_MANAGED_STATE

# Copy guild-agents/strategist/agent.ts over this scaffold's agent.ts.
npx --yes @guildai/cli@0.17.0 agent test --mode json
npx --yes @guildai/cli@0.17.0 agent save \
  --message "Publish HumanHarness strategist" \
  --wait \
  --publish
```

Each published specialist must have a version compatible with `^1.0.0` before
the router can resolve it. For a Guild owner other than `oceanseth`, replace the
owner in all four router imports and dependency names:

```text
@guildai/<owner>~humanharness-strategist/tool
@guildai/<owner>~humanharness-historian/tool
@guildai/<owner>~humanharness-hypecaster/tool
@guildai/<owner>~humanharness-scout/tool
```

Then initialize the router scaffold, copy `router/agent.ts`, and merge the four
`@guildai/<owner>~humanharness-*` dependencies from `router/package.json` into
the scaffold's generated manifest. Keep the top-level `"use agent"` directive;
Guild requires compilation for sub-agent calls.

```bash
npx --yes @guildai/cli@0.17.0 agent test --mode json
npx --yes @guildai/cli@0.17.0 agent capabilities --output json
npx --yes @guildai/cli@0.17.0 agent save \
  --message "Publish HumanHarness multi-agent router" \
  --wait \
  --publish
```

Install the published router in the target workspace and create the API trigger
on that router. The specialists remain independently installable and runnable,
while the router reaches their published versions through the typed agent-tool
dependencies.

The agent-to-agent pattern follows Guild's official
[Calling an Agent as a Tool](https://www.guild.ai/blog/engineering/guild-user-control-plane-tips-tricks#calling-an-agent-as-a-tool)
guidance and the compiled-agent requirements in
[Auto-managed state agents](https://docs.guild.ai/guide/coded-agents#compilation-required-for-sub-agents-and-service-hooks).
