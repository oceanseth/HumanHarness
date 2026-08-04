"use agent"

import { agent, noTools } from "@guildai/agents-sdk"
import { z } from "zod"

const inputSchema = z.object({
  trigger: z.string(),
  goal: z.string(),
  signals: z.array(z.unknown()),
  memories: z.array(z.unknown()),
})
type Input = z.infer<typeof inputSchema>

const outputSchema = z.object({
  persona: z.literal("hypecaster"),
  decision: z.string(),
  priority: z.enum(["low", "normal", "high"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  directives: z.array(z.string()),
  lookup: z.string().nullable(),
})
type Output = z.infer<typeof outputSchema>

const tools = { ...noTools }

const peakPattern =
  /\b(win|won|victory|clutch|ace|knockout|ko|boss down|defeated|clear(?:ed)?|completed|milestone|record|unlocked|level up|comeback|breakthrough|champion|achievement)\b/i
const momentumPattern =
  /\b(close|almost|near miss|save|saved|survive(?:d)?|escape(?:d)?|combo|streak|final|boss|intense|turnaround|progress|discovered|found|finish|score|celebrat|hype)\w*\b/i

function compact(value: string, limit = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

function describe(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }

  const seen = new WeakSet<object>()

  try {
    const json = JSON.stringify(value, (_key, nested: unknown) => {
      if (typeof nested === "bigint") return nested.toString()
      if (typeof nested === "symbol" || typeof nested === "function") return String(nested)
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[Circular]"
        seen.add(nested)
      }
      return nested
    })

    if (json !== undefined) return json
  } catch {
    // Fall through to a representation that also handles non-JSON runtime values.
  }

  try {
    return String(value)
  } catch {
    return "[unreadable value]"
  }
}

function scalarText(value: unknown): string {
  const parts: string[] = []
  const seen = new WeakSet<object>()

  const collect = (nested: unknown, depth: number): void => {
    if (parts.length === 32 || nested === null || nested === undefined) return

    if (
      typeof nested === "string" ||
      typeof nested === "number" ||
      typeof nested === "boolean" ||
      typeof nested === "bigint"
    ) {
      const valueText = compact(String(nested), 300)
      if (valueText) parts.push(valueText)
      return
    }

    if (typeof nested !== "object" || depth === 4 || seen.has(nested)) return
    seen.add(nested)

    if (Array.isArray(nested)) {
      for (const item of nested) {
        collect(item, depth + 1)
        if (parts.length === 32) break
      }
      return
    }

    let keys: string[]
    try {
      keys = Object.keys(nested).sort()
    } catch {
      return
    }

    for (const key of keys) {
      try {
        collect((nested as Record<string, unknown>)[key], depth + 1)
      } catch {
        // Ignore an inaccessible value while retaining the remaining signal data.
      }
      if (parts.length === 32) break
    }
  }

  collect(value, 0)
  return compact(parts.join(" "), 1_600)
}

function evidenceFor(input: Input): string[] {
  const trigger = compact(input.trigger)
  const signals = input.signals
    .map((signal, index) => ({
      index,
      text: compact(describe(signal)),
      classificationText: scalarText(signal),
    }))
    .filter(({ text }) => text.length > 0)
  const relevantSignals = signals.filter(
    ({ classificationText }) => peakPattern.test(classificationText) || momentumPattern.test(classificationText),
  )
  const selectedSignals = relevantSignals.length > 0 ? relevantSignals : signals.slice(0, 1)
  const evidence: string[] = []

  if (trigger) evidence.push(`Trigger: ${trigger}`)
  for (const { index, text } of selectedSignals) {
    if (evidence.length === 3) break
    evidence.push(`Signal ${index + 1}: ${text}`)
  }

  return evidence.length > 0 ? evidence : ["No concrete moment signal was supplied."]
}

async function run(input: Input): Promise<Output> {
  const currentMoment = [
    compact(input.trigger, 800),
    ...input.signals.map(scalarText),
  ].join(" ")
  const isPeak = peakPattern.test(currentMoment)
  const hasMomentum = isPeak || momentumPattern.test(currentMoment)
  const hasGoal = input.goal.trim().length > 0
  const hasMemory = input.memories.length > 0

  if (isPeak) {
    return {
      persona: "hypecaster",
      decision: "Amplify the confirmed peak.",
      priority: "high",
      summary: hasGoal
        ? "Peak-moment brief: foreground the payoff, then connect its significance to the stated goal."
        : "Peak-moment brief: foreground the payoff and keep the significance anchored to what just happened.",
      evidence: evidenceFor(input),
      directives: [
        "Name the observable payoff first.",
        "Use one vivid beat and do not invent stakes.",
        ...(hasGoal
          ? [`Connect the payoff to the goal: ${compact(input.goal, 80)}.`]
          : hasMemory
            ? ["Use prior context only as a short callback; keep the present moment dominant."]
            : []),
      ],
      lookup: null,
    }
  }

  if (hasMomentum) {
    return {
      persona: "hypecaster",
      decision: "Build energy around the turn.",
      priority: "normal",
      summary: "Momentum brief: mark what changed, lift the energy one step, and leave room for the payoff.",
      evidence: evidenceFor(input),
      directives: [
        "Lead with the change in the current moment.",
        "Build anticipation without declaring an unconfirmed win.",
        ...(hasGoal ? [`Relate the turn to the goal: ${compact(input.goal, 80)}.`] : []),
        ...(hasMemory ? ["Use memory only if it makes the present turn clearer."] : []),
      ],
      lookup: null,
    }
  }

  return {
    persona: "hypecaster",
    decision: "Hold for a stronger beat.",
    priority: "low",
    summary: "Restraint brief: keep the energy low until a concrete turn, payoff, or near miss appears.",
    evidence: evidenceFor(input),
    directives: [
      "Do not manufacture a celebration.",
      "Wait for an observable change before escalating the tone.",
    ],
    lookup: null,
  }
}

export default agent({ inputSchema, outputSchema, tools, run })
