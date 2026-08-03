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

### Prerequisites

- Python 3.11+
- [ffmpeg](https://ffmpeg.org/) and [streamlink](https://streamlink.github.io/) on PATH
- Docker (for FalkorDB)
- API keys: LaserData, RocketRide.ai, Guild.ai, masky.ai, and an STT provider (OpenAI Whisper API or Deepgram)

### 1. Clone & install

```bash
git clone https://github.com/oceanseth/HumanHarness
cd HumanHarness
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Start FalkorDB

```bash
docker run -d --name humanharness-memory -p 6379:6379 falkordb/falkordb
```

### 3. Configure

Copy `.env.example` to `.env` and fill in:

```ini
TWITCH_CHANNEL=your_channel_name

LASERDATA_API_KEY=...
LASERDATA_STREAM=humanharness-live

FALKORDB_URL=redis://localhost:6379
FALKORDB_GRAPH=humanharness

ROCKETRIDE_API_KEY=...
GUILD_API_KEY=...
MASKY_API_KEY=...

STT_PROVIDER=whisper          # whisper | deepgram
OPENAI_API_KEY=...            # if whisper
DEEPGRAM_API_KEY=...          # if deepgram

FRAME_INTERVAL_MS=500
```

### 4. Run

```bash
python -m humanharness run --channel $TWITCH_CHANNEL
```

This starts three processes:

- **ingest** — streamlink/ffmpeg pipeline: 500 ms frame grabs → labeler → LaserData; audio → STT → LaserData
- **memory** — LaserData consumer → FalkorDB graph writer
- **crew** — Guild.ai session hosting the four personas, with RocketRide.ai as the action layer and masky.ai for voices

Then just talk — your mic/stream audio is transcribed and the crew hears you. Set a goal out loud ("help me beat this boss without healing items") and the personas will optimize their commentary and actions around it.

## Repo layout

```
humanharness/
  ingest/       # streamlink + ffmpeg wrappers, 500ms frame loop, STT
  perceive/     # frame labeler (vision model → structured labels)
  signals/      # LaserData publisher + consumer
  memory/       # FalkorDB graph schema + writers/readers
  actions/      # RocketRide.ai orchestration flows
  crew/         # Guild.ai agent definitions, persona prompts, masky.ai voices
  cli.py
.env.example
requirements.txt
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
