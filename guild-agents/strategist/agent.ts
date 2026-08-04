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
  persona: z.literal("strategist"),
  decision: z.string(),
  priority: z.enum(["low", "normal", "high"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  directives: z.array(z.string()),
  lookup: z.string().nullable(),
})
type Output = z.infer<typeof outputSchema>

const tools = { ...noTools }

const clean = (value: string, limit = 180): string => {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1).trimEnd()}…`
}

const primitiveText = (value: unknown): string | null => {
  if (typeof value === "string") return clean(value)
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "boolean") return String(value)
  if (typeof value === "bigint") return value.toString()
  return null
}

const describe = (value: unknown): string => {
  const primitive = primitiveText(value)
  if (primitive !== null) return primitive
  if (value === null || value === undefined) return ""

  const seen = new WeakSet<object>()
  try {
    const json = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return nested.toString()
      if (typeof nested === "number" && !Number.isFinite(nested)) return String(nested)
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[circular]"
        seen.add(nested)
      }
      return nested
    })
    return typeof json === "string" ? clean(json) : ""
  } catch {
    return "[unreadable input]"
  }
}

const fieldText = (value: unknown, keys: string[]): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const record = value as Record<string, unknown>
  const parts: string[] = []

  for (const key of keys) {
    let candidate: unknown
    try {
      candidate = record[key]
    } catch {
      continue
    }
    if (Array.isArray(candidate)) {
      const items = candidate.map(primitiveText).filter((item): item is string => Boolean(item))
      if (items.length > 0) parts.push(items.slice(0, 4).join(", "))
      continue
    }
    const text = primitiveText(candidate)
    if (text) parts.push(text)
  }

  return clean(parts.join("; "))
}

const describeSignal = (value: unknown): string =>
  fieldText(value, ["summary", "scene", "events", "objects", "status", "error", "message", "kind", "type"]) ||
  describe(value)

const describeMemory = (value: unknown): string =>
  fieldText(value, ["summary", "scene", "events", "outcome", "result", "name", "description"]) ||
  describe(value)

const includesAny = (text: string, pattern: RegExp): boolean => pattern.test(text)

const run = async (input: Input): Promise<Output> => {
  const goal = clean(input.goal)
  const trigger = clean(input.trigger)
  const usefulSignals = input.signals.map(describeSignal).filter(Boolean)
  const latestSignal = usefulSignals.at(-1) ?? ""
  const usefulMemories = input.memories.map(describeMemory).filter(Boolean)
  const memory = usefulMemories[0] ?? ""
  const context = `${trigger} ${goal} ${latestSignal}`.toLowerCase()
  const memoryContext = memory.toLowerCase()

  const healthRisk = includesAny(
    context,
    /\b(critical health|low health|one more hit|one hit|dying|lethal|fatal|wounded|no health|near death)\b/,
  )
  const immediateThreat = includesAny(
    context,
    /\b(urgent|immediate|incoming|attack(?:s|ed|ing)?|telegraph(?:s|ed|ing)?|danger|warning|ambush|under fire|now)\b/,
  )
  const blocker = includesAny(
    context,
    /\b(blocked|blocker|stuck|failed|failure|error|crash(?:ed)?|unavailable|cannot|can't)\b/,
  )
  const opening = includesAny(
    `${context} ${memoryContext}`,
    /\b(opening|recovery window|vulnerable|weakness|exposed|staggered|opportunity)\b/,
  )
  const passive = includesAny(context, /\b(idle|waiting|paused|safe|stable|complete|completed)\b/)

  const priority: Output["priority"] = healthRisk || immediateThreat || blocker
    ? "high"
    : !goal && !latestSignal
      ? "low"
      : passive
        ? "low"
        : "normal"

  let decision: string
  let summary: string
  let directives: string[]

  if (healthRisk) {
    decision = "Preserve the run before pursuing the objective."
    summary = "Critical survivability risk."
    directives = [
      "Create distance or cover now.",
      "Recover before re-engaging.",
      goal ? `Resume ${goal} only when stable.` : "Reassess once stable.",
    ]
  } else if (immediateThreat) {
    decision = opening
      ? "Evade the immediate threat, then punish the opening."
      : "Neutralize the immediate threat before advancing."
    summary = "Immediate threat requires a defensive first move."
    directives = opening
      ? ["Evade first.", "Counter during the recovery window.", "Reset if the opening closes."]
      : ["Defend or reposition now.", "Confirm the threat has passed.", "Advance only from a safe state."]
  } else if (blocker) {
    decision = "Clear the blocker before resuming the objective."
    summary = "The current path is blocked."
    directives = ["Stop repeating the failing move.", "Isolate the blocking condition.", "Retry the smallest safe step."]
  } else if (opening) {
    decision = "Exploit the known opening without overcommitting."
    summary = "Current context matches an actionable opening."
    directives = ["Commit during the opening.", "Keep an exit route.", "Reset after the window closes."]
  } else if (goal) {
    decision = `Advance ${goal} with one controlled next move.`
    summary = latestSignal ? "The latest signal supports measured progress." : "The goal is clear; current context is sparse."
    directives = ["Choose the smallest reversible step.", "Watch the next signal for risk.", "Replan if conditions change."]
  } else {
    decision = "Hold until the objective and next actionable signal are clear."
    summary = latestSignal ? "A signal exists, but no goal is stated." : "No actionable context."
    directives = ["State the objective.", "Wait for a concrete change."]
  }

  const evidence = [
    goal ? `Goal: ${goal}` : "",
    latestSignal ? `Latest signal: ${latestSignal}` : "",
    memory ? `Relevant memory: ${memory}` : "",
  ].filter(Boolean)

  return {
    persona: "strategist",
    decision,
    priority,
    summary,
    evidence,
    directives,
    lookup: null,
  }
}

export default agent({ inputSchema, outputSchema, tools, run })
