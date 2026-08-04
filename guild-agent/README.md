# HumanHarness Guild router

`agent.ts` is a Guild TypeScript auto-managed state agent. It receives the
current trigger, goal, signals, and graph memories, then returns the specialist
persona that should handle the moment. The routing is deterministic and makes
no Guild LLM call; the Electron app uses MiniMax to write the selected
persona's spoken line.

Guild agent projects are created and published through the Guild CLI because
`guild.json` and the agent's remote repository are managed by Guild. Initialize
the remote project outside this repository, copy the checked-in artifact over
its scaffold, and publish it:

```bash
npm install -g @guildai/cli
guild auth login
guild agent init --name humanharness-router
cp /path/to/HumanHarness/guild-agent/agent.ts humanharness-router/agent.ts
cp /path/to/HumanHarness/guild-agent/package.json humanharness-router/package.json
cp /path/to/HumanHarness/guild-agent/tsconfig.json humanharness-router/tsconfig.json
cd humanharness-router
git add agent.ts package.json tsconfig.json
guild agent save --message "Add HumanHarness router" --wait --publish
```

Install the published agent in the target workspace and create an API trigger
for it in **More → Triggers**. Copy the combined trigger credential shown at
creation time and configure the Electron app:

```ini
GUILD_API_KEY=<api_key_id>:<api_key_secret>
GUILD_WORKSPACE_OWNER=<owner_name>
GUILD_WORKSPACE=<workspace_name>
```

The Agent SDK and Zod are supplied by Guild's runtime and intentionally are not
application dependencies. The agent does not call `task.llm`, because Guild's
current BYOK provider list does not include MiniMax.
