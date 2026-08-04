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
  persona: z.literal("scout"),
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
  fieldText(value, ["summary", "scene", "events", "objects", "status", "message", "kind", "type"]) ||
  describe(value)

const describeMemory = (value: unknown): string =>
  fieldText(value, ["summary", "scene", "events", "outcome", "result", "name", "description"]) ||
  describe(value)

const UPCOMING_CUE = /\b(?:next|ahead|upcoming|coming\s+up|after\s+this|later|future)\b/
const SCHEDULE_CUE = /\b(?:schedule|scheduled|timeline|timetable|calendar|when|eta|deadline|kickoff|starts?\s+(?:at|on|in)|begins?\s+(?:at|on|in))\b/
const LOCATION_CUE = /\b(?:where|location|located|map|route|path|direction|door|entrance|exit|destination|area|level|stage|spawn)\b/
const RECON_CUE = /\b(?:look\s*up|lookup|recon(?:naissance)?|scout|research|search|find\s+out|investigate)\b/
const URGENT_CUE = /\b(?:urgent|immediately|now|soon|incoming|danger|hazard|warning|ambush|boss|missable|limited[- ]time)\b/

const matchesReconContext = (text: string): boolean =>
  UPCOMING_CUE.test(text) ||
  SCHEDULE_CUE.test(text) ||
  LOCATION_CUE.test(text) ||
  RECON_CUE.test(text)

const unique = (values: string[]): string[] => {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const run = async (input: Input): Promise<Output> => {
  const trigger = clean(input.trigger)
  const goal = clean(input.goal)
  const recentSignals = input.signals.slice(-3).map(describeSignal).filter(Boolean)
  const memories = input.memories.slice(0, 2).map(describeMemory).filter(Boolean)
  const activeContext = [trigger, goal, ...recentSignals].join(" ").toLowerCase()

  const hasUpcomingCue = UPCOMING_CUE.test(activeContext)
  const hasScheduleCue = SCHEDULE_CUE.test(activeContext)
  const hasLocationCue = LOCATION_CUE.test(activeContext)
  const hasReconCue = RECON_CUE.test(activeContext)
  const needsRecon = hasUpcomingCue || hasScheduleCue || hasLocationCue || hasReconCue
  const directRequest = trigger.toLowerCase() !== "tick" && matchesReconContext(trigger.toLowerCase())
  const urgent = URGENT_CUE.test(activeContext)

  const priority: Output["priority"] = needsRecon
    ? directRequest || urgent
      ? "high"
      : "normal"
    : "low"

  let decision: string
  let summary: string
  let directives: string[]

  if (!needsRecon) {
    decision = "Hold reconnaissance until an upcoming target is identified."
    summary = "No upcoming route, schedule, or location cue."
    directives = ["Monitor for the next objective, route, schedule, or location cue."]
  } else {
    decision = hasLocationCue
      ? "Verify the destination and route before committing."
      : hasScheduleCue
        ? "Verify the timing before committing."
        : hasUpcomingCue
          ? "Reconnoiter what comes next before committing."
          : "Run the requested reconnaissance before committing."
    summary = hasLocationCue && hasScheduleCue
      ? "Upcoming location and timing require verification."
      : hasLocationCue
        ? "Upcoming route or location requires verification."
        : hasScheduleCue
          ? "Upcoming timing requires verification."
          : hasUpcomingCue
            ? "The next objective needs focused reconnaissance."
            : "The requested target needs focused reconnaissance."
    directives = [
      hasUpcomingCue || hasLocationCue ? "Identify the next destination and safest route." : "Identify the reconnaissance target.",
      hasScheduleCue ? "Confirm timing, order, and any deadline." : "Confirm access requirements and dependencies.",
      "Flag hazards, uncertainty, and time-sensitive details.",
    ]
  }

  const latestSignal = recentSignals.at(-1) ?? ""
  const reconSignal = [...recentSignals].reverse().find(matchesReconContext) ?? latestSignal
  const memory = memories[0] ?? ""
  const evidence = [
    trigger && trigger.toLowerCase() !== "tick" ? `Trigger: ${trigger}` : "",
    goal ? `Goal: ${goal}` : "",
    reconSignal ? `Recon signal: ${reconSignal}` : "",
    memory ? `Relevant memory: ${memory}` : "",
  ].filter(Boolean)

  const queryContext = unique([
    trigger.toLowerCase() !== "tick" ? trigger : "",
    goal,
    reconSignal,
  ]).join(" | ")
  const lookupFocus = hasUpcomingCue || hasScheduleCue || hasLocationCue
    ? "next route, location, timing, and risks"
    : "requested target, constraints, and risks"
  const lookup = needsRecon
    ? clean(`Recon ${lookupFocus}: ${queryContext || "current objective"}`, 240)
    : null

  return {
    persona: "scout",
    decision,
    priority,
    summary,
    evidence,
    directives,
    lookup,
  }
}

export default agent({ inputSchema, outputSchema, tools, run })
