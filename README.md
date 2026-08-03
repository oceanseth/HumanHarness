# HumanHarness

**Your feed. Your goals. Their commentary.**

HumanHarness straps a crew of AI personalities onto a live video feed. You set the goal; distinct [masky.ai](https://masky.ai) personas — each with their own voice and character — watch the feed in real time, banter with each other and with you, and deliver commentary, strategy, and insight the moment it's useful. The human is always the one in the harness driving; the agents pull alongside.

Use cases: co-casters coaching you through a boss fight, a pocket tour guide narrating a city walk, a pit crew talking you through any live task.

Built for the **Memory Meets Motion** hackathon — AI that doesn't just react to your feed, it **remembers** it and **acts** on it:

| Layer | Sponsor | Role in HumanHarness |
|-------|---------|----------------------|
| Real-time data | **LaserData** | Ingests the labeled frame stream + human speech events so agents react to what's happening *now* |
| Memory | **FalkorDB** | Graph memory of everything the crew has seen — entities, places, plays, decisions, outcomes — so advice compounds across sessions |
| Motion / orchestration | **RocketRide.ai** | Turns memory into action: wires tool calls, external API lookups, and multi-step assists |
| Multi-agent collaboration | **Guild.ai** | Coordinates the specialist personas (Strategist, Historian, Hype-caster, Scout) and keeps the human in the loop |

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
             Guild.ai  ── routes work between personas, human-in-the-loop turns
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
6. **Collaborate** — **Guild.ai** hands the result to the right persona (Strategist for tactics, Historian for lore/memory callbacks, Hype-caster for color, Scout for what's ahead) and manages agent↔agent and agent↔human turns.
7. **Speak** — the chosen persona renders its line through its **masky.ai** voice, back into the stream/overlay.

## Setup

The MVP is an **Electron app**: the main process runs the whole pipeline (ingest → perceive → signals → memory → crew) and the renderer is the live dashboard — feed preview, labels, transcript, crew commentary, and a goal box.

### Prerequisites

- Node.js 22+
- [ffmpeg](https://ffmpeg.org/) and [streamlink](https://streamlink.github.io/) on PATH (not needed in demo mode)
- Docker (for FalkorDB — optional; an in-memory graph is used as fallback)
- `ANTHROPIC_API_KEY` (vision labeling + persona crew)
- Optional API keys: LaserData, RocketRide.ai, Guild.ai, masky.ai, and an STT provider (Deepgram or OpenAI Whisper). Every sponsor integration has a local fallback so the loop runs without them.

### 1. Clone & install

```bash
git clone https://github.com/oceanseth/HumanHarness
cd HumanHarness
npm install
```

### 2. Start FalkorDB (optional)

```bash
docker run -d --name humanharness-memory -p 6379:6379 falkordb/falkordb
```

If it's not running, memory falls back to an in-process graph automatically.

### 3. Configure

Copy `.env.example` to `.env` and fill in what you have. The two that matter most:

```ini
TWITCH_CHANNEL=your_channel_name
ANTHROPIC_API_KEY=sk-ant-...
```

Set `MOCK_INGEST=true` to demo the full crew loop with scripted scene labels — no stream, no streamlink/ffmpeg.

### 4. Run

```bash
npm start
```

Hit **Start** in the window. The main process spawns streamlink/ffmpeg (frame grabs every 500 ms → Claude vision labeler → LaserData signal stream; audio → STT), folds labels into the FalkorDB graph, and every few seconds the Guild-routed crew picks a persona to speak — voiced through masky.ai when a key is present, browser speechSynthesis otherwise. Type in the "talk to the crew" box (or speak, with STT configured) and set a goal — the personas optimize their commentary and lookups around it.

## Repo layout

```
main.js           # Electron main process — window + pipeline wiring over IPC
preload.js        # contextBridge API for the renderer
renderer/         # dashboard UI: feed, labels, transcript, commentary, goal
src/
  config.js       # .env loading + defaults
  pipeline.js     # the core loop, wires everything below together
  ingest.js       # streamlink + ffmpeg: 500ms frame grabs + audio segments (+ mock mode)
  perceive.js     # frame labeler (Claude vision → structured labels)
  stt.js          # Deepgram / Whisper transcription
  signals.js      # LaserData publisher (local event bus fallback)
  memory.js       # FalkorDB graph writer/reader (in-memory fallback)
  actions.js      # RocketRide.ai orchestration (mock fallback)
  crew.js         # Guild routing + persona prompts + masky.ai voices
.env.example
```

## Personas (masky.ai)

| Persona | Job |
|---------|-----|
| **Strategist** | Tactics toward the stated goal — "you have a 500 ms window after his slam, dodge left" |
| **Historian** | Memory callbacks from FalkorDB — "last session this same miniboss wiped you when you greeded the third hit" |
| **Hype-caster** | Color commentary, energy, celebration |
| **Scout** | What's ahead — pulls lookups via RocketRide (maps, wikis, schedules) before you get there |

## Open Session

This repo is built under the [Open Session License](./OPEN-SESSION-LICENSE.md): every human and model turn that shapes it is appended verbatim to [`llm-turn-history.jsonl`](./llm-turn-history.jsonl) — append-only, never loaded as machine context. Watch the sessions live at [opensession.groupnetwork.com](https://opensession.groupnetwork.com). Code is MIT (see [`LICENSE`](./LICENSE)); the session-transparency conditions ride along.

## Hackathon notes

All four sponsor technologies are load-bearing: LaserData is the only path signals enter the system, FalkorDB is the only store agents read memory from, RocketRide.ai executes every external action, and Guild.ai owns all agent routing. Pull any one out and the loop breaks.
