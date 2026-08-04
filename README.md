# HumanHarness

**One human. Many minds. Shared vision.**

> HumanHarness gives every person a live team of AI experts that watch what they see, discuss it together, and help them achieve their goals in real time.

<p align="center">
  <a href="https://youtu.be/5OYzcYGDgJc">
    <img src="docs/video-poster.jpg" alt="HumanHarness — 1-minute hackathon video" width="480" />
  </a>
  <br />
  <a href="https://youtu.be/5OYzcYGDgJc">▶ Watch the 1-minute video</a>
</p>

HumanHarness is a real-time human–AI collaboration platform: multiple AI agents watch the same live video feed as a human, discuss what they observe, and provide guidance, analysis, and ideas through distinct personalities and areas of expertise. The name is the point — like a team of horses pulling in harness, except here the human is guiding a team of specialized AI minds. The human is not being replaced but **amplified**: the human is the source of intent and agency; the AI collective provides leverage, not control.

Powered by [masky.ai](https://masky.ai) personalities and voices, every agent has a unique perspective, expertise, and communication style — so it feels less like asking a chatbot questions and more like collaborating with an expert team that's always looking over your shoulder. Agents debate strategies, surface relevant information, anticipate problems, and communicate naturally with each other and with you, optimized toward whatever goal you choose.

## Example use cases

- 🎮 **Gaming coach** — strategy agents debate optimal plays while spectators interact with them
- 🗺️ **City tour guide** — historians, food critics, architects, and locals comment as you walk
- 🔧 **Repair assistant** — engineering agents identify components and suggest next steps
- 📚 **Education** — professors from different disciplines explain what you're seeing
- 🧑‍🍳 **Cooking** — chefs monitor technique and timing while nutritionists suggest improvements
- 🚗 **Driving or navigation** — agents highlight hazards, landmarks, and route alternatives
- 🏭 **Industrial operations** — safety, maintenance, and process experts monitor live workflows
- ♿ **Accessibility** — agents describe surroundings and read signs for visually impaired users

Built for the **Memory Meets Motion** hackathon — AI that doesn't just react to your feed, it **remembers** it and **acts** on it:

| Layer | Sponsor | Role in HumanHarness |
|-------|---------|----------------------|
| Real-time data | **LaserData** | Ingests the labeled frame stream + human speech events so agents react to what's happening *now* |
| Memory | **FalkorDB** | Graph memory of everything the crew has seen — entities, places, plays, decisions, outcomes — so advice compounds across sessions |
| Motion / orchestration | **RocketRide.ai** | Turns memory into action: wires tool calls, external API lookups, and multi-step assists |
| Multi-agent collaboration | **Guild.ai** | Runs a router agent that dispatches to independently deployed Strategist, Historian, Hype-caster, and Scout agents |

## Architecture (MVP)

```
Twitch stream (video + audio)
        │
        ├── streamlink → ffmpeg ──► frame grab every 500 ms
        │                                │
        │                                ▼
        │                        vision labeler (frame → scene/object/event labels)
        │                                │
        └── audio ──► STT (human speech → text)
                                         │
                 ┌───────────────────────┤
                 ▼                       ▼
            LaserData  ◄── labeled frames + speech events (real-time signal stream)
                 │
                 ▼
            FalkorDB   ◄── entity/relationship graph, session + cross-session memory
                 │
                 ▼
          RocketRide.ai ── orchestrates decisions: lookups, tools, multi-step assists
                 │
                 ▼
             Guild.ai  ── router agent invokes one specialist agent as a typed tool
                 │
                 ▼
          local MiniMax ── writes the selected specialist's commentary
                 │
                 ▼
        masky.ai personas (voice + character) ──► TTS commentary back to the human
```

The core loop:

1. **Ingest** — `streamlink` pulls the Twitch HLS feed; `ffmpeg` splits it into a 2 fps frame stream (one screenshot every 500 ms) and a 16 kHz mono audio stream.
2. **Perceive** — each frame is labeled by a vision model (scene, objects, on-screen events); the audio stream runs through STT so the human can just *talk* to the crew.
3. **Stream** — labeled frames and speech transcripts are published to **LaserData** as the live signal feed.
4. **Remember** — a consumer folds LaserData events into a **FalkorDB** graph: entities (bosses, streets, items, people) and relationships (defeated-by, located-in, mentioned-at), persisted across sessions.
5. **Act** — **RocketRide.ai** takes "what's happening + what we remember" and orchestrates actions: wiki lookups, map queries, strategy tools.
6. **Collaborate** — a **Guild.ai** router deterministically selects and invokes one independently deployed specialist agent (Strategist for tactics, Historian for memory callbacks, Hype-caster for color, or Scout for what's ahead). The specialist returns a structured decision brief without calling a Guild LLM.
7. **Speak** — local **MiniMax** turns that structured brief into the selected persona's line, which is rendered through its **masky.ai** voice back into the stream/overlay.

## Setup

The MVP is an **Electron app**: the main process runs the whole pipeline (ingest → perceive → signals → memory → crew) and the renderer is the live dashboard — feed preview, labels, transcript, crew commentary, and a goal box.

### Prerequisites

- Node.js 22+
- [ffmpeg](https://ffmpeg.org/) and [streamlink](https://streamlink.github.io/) on PATH (not needed in demo mode)
- A reachable FalkorDB instance, either local or managed
- Working LaserData data-plane credentials
- A RocketRide API key and deployed `ride.pipe`
- Five published Guild agents, an installed router, and API-trigger credentials
- `MINIMAX_KEY` from a MiniMax Token Plan (vision labeling, RocketRide lookup pipeline, and persona commentary)
- Optional: masky.ai avatar credentials and an STT provider (Deepgram or OpenAI Whisper)

### 1. Clone & install

```bash
git clone https://github.com/oceanseth/HumanHarness
cd HumanHarness
npm install
```

### 2. Provide FalkorDB

Locally:

```bash
docker run -d --name humanharness-memory -p 6379:6379 falkordb/falkordb
```

Or point `FALKORDB_URL` at a managed FalkorDB Cloud instance. Use the scheme the
instance actually serves — `rediss://` only if it terminates TLS on that port,
`redis://` otherwise. A `rediss://` URL against a plaintext port looks exactly
like an unreachable instance. FalkorDB is mandatory; a connection or health-check
failure blocks startup.

### 3. Configure

Copy `.env.example` to `.env` and configure the complete required chain:

```ini
MINIMAX_KEY=sk-cp-...
LASER_CONNECTION_STRING=<token>@<deployment>.laserdata.cloud
FALKORDB_URL=redis://localhost:6379
ROCKETRIDE_API_KEY=rr_...
GUILD_API_KEY=<api_key_id>:<api_key_secret>
GUILD_WORKSPACE_OWNER=<owner_name>
GUILD_WORKSPACE=<workspace_name>
```

Set `MOCK_INGEST=true` to replace Twitch, streamlink, and ffmpeg with scripted
scene labels. Mock ingest still traverses every required service; it is not a
sponsor-service fallback.

Additional configuration includes:

```ini
MASKY_API_KEY=mky_...                                          # plus MASKY_<PERSONA>_AVATAR_ID and _OWNER_USER_ID
TWITCH_CHANNEL=your_channel_name                               # unless MOCK_INGEST=true
```

Guild routing uses an [API trigger](https://docs.guild.ai/platform/triggers#api-triggers).
Create and publish the four specialists in `guild-agents/` first, publish the
router with their generated `/tool` packages as dependencies, install the router
in a workspace, and create an API trigger on it. The complete publish order and
owner-name substitutions are documented in [`guild-agents/README.md`](./guild-agents/README.md).
Then configure the combined trigger credentials and workspace URL slugs:

```ini
GUILD_API_KEY=<api_key_id>:<api_key_secret>
GUILD_WORKSPACE_OWNER=<owner_name>
GUILD_WORKSPACE=<workspace_name>
```

The Agent SDK stays inside Guild's runtime; Electron calls only the documented
sessions/events HTTP API. Guild's router invokes the selected specialist and
returns its deterministic brief, then MiniMax writes that persona's line locally.
No Guild agent calls `task.llm`.

Startup probes the sponsor chain in order: **LaserData → FalkorDB → RocketRide →
Guild**. The app does not start voices, ingest, or commentary until all four are
ready. Guild readiness dispatches through Strategist, Historian, Hype-caster,
and Scout, so all five deployed Guild projects must execute successfully.
Missing configuration, failed health checks, authentication errors, and timeouts
emit `BLOCKED <service>`, tear down the connected prefix in reverse order, and
leave the app stopped. A runtime failure in any of the four services stops the
active pipeline the same way.

### 4. Run

```bash
npm start
```

Hit **Start** in the window. The main process spawns streamlink/ffmpeg (frame grabs every 500 ms → MiniMax image understanding → LaserData signal stream; audio → STT), folds labels into the FalkorDB graph, and every few seconds the Guild-routed crew picks a persona to speak — voiced through masky.ai when a key is present, browser speechSynthesis otherwise. Type in the "talk to the crew" box (or speak, with STT configured) and set a goal — the personas optimize their commentary and lookups around it.

### Deterministic moment replay

Recorded moments use the same Node.js runtime as the Electron app and model the data exchanged by ingest, memory, action, and persona adapters. Replay is fully offline: it makes no sponsor API calls, picks the highest-priority persona proposal (source order breaks ties), and collects action requests.

```bash
npm test
npm run replay -- test/fixtures/boss-fight.jsonl
```

The boss-fight fixture replays 3 moments into 2 commentary decisions and 1 action request. Unknown contract fields, invalid nested values, and timestamps without a timezone fail with the JSONL line number.

## Repo layout

```
main.js           # Electron main process — window + pipeline wiring over IPC
preload.js        # contextBridge API for the renderer
renderer/         # dashboard UI: feed, labels, transcript, commentary, goal
src/
  config.js       # .env loading + defaults
  pipeline.js     # the core loop, wires everything below together
  ingest.js       # streamlink + ffmpeg: 500ms frame grabs + audio segments (+ mock mode)
  perceive.js     # frame labeler (MiniMax vision → structured labels)
  stt.js          # Deepgram / Whisper transcription
  signals.js      # required LaserData publisher
  memory.js       # required FalkorDB graph writer/reader
  actions.js      # required RocketRide.ai orchestration
  guild.js        # required Guild router API-trigger client
  crew.js         # Specialist brief → local MiniMax persona prompt + masky.ai voice
  moments.js      # provider-neutral moment contracts + runtime validation
  replay.js       # deterministic offline JSONL replay
bin/
  humanharness.js # Node CLI for replaying recorded moments
test/             # contract, replay, CLI tests + boss-fight fixture
guild-agents/     # Source for five independently versioned Guild TypeScript agents
ride.pipe         # RocketRide Scout lookup pipeline (MiniMax credentials injected at runtime)
.env.example
```

## Personas (masky.ai)

| Persona | Job |
|---------|-----|
| **Strategist** | Tactics toward the stated goal — "you have a 500 ms window after his slam, dodge left" |
| **Historian** | Memory callbacks from FalkorDB, voiced by Masky's HH Historian (Adolph Sutro) avatar |
| **Hype-caster** | Color commentary, energy, celebration |
| **Scout** | What's ahead — pulls lookups via RocketRide (maps, wikis, schedules) before you get there |

## Open Session

This repo is built under the [Open Session License](./OPEN-SESSION-LICENSE.md): every human and model turn that shapes it is appended verbatim to [`llm-turn-history.jsonl`](./llm-turn-history.jsonl) — append-only, never loaded as machine context. Watch the sessions live at [opensession.groupnetwork.com](https://opensession.groupnetwork.com). Code is MIT (see [`LICENSE`](./LICENSE)); the session-transparency conditions ride along.

## Hackathon notes

All four sponsor technologies are load-bearing: LaserData is the only path signals enter the system, FalkorDB is the only store agents read memory from, RocketRide.ai executes every external action, and Guild.ai owns all agent routing. Pull any one out and the loop breaks.
