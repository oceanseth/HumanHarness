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
  persona: z.literal("historian"),
  decision: z.string(),
  priority: z.enum(["low", "normal", "high"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  directives: z.array(z.string()),
  lookup: z.string().nullable(),
})
type Output = z.infer<typeof outputSchema>

const tools = { ...noTools }

const MAX_DEPTH = 4
const MAX_ITEMS = 48
const MAX_VALUE_LENGTH = 180
const MAX_CONTEXT_LENGTH = 1_600

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "before",
  "being",
  "callback",
  "content",
  "current",
  "data",
  "description",
  "detail",
  "entity",
  "error",
  "event",
  "false",
  "from",
  "goal",
  "have",
  "id",
  "identifier",
  "into",
  "kind",
  "label",
  "memory",
  "message",
  "name",
  "object",
  "outcome",
  "phase",
  "remember",
  "repeat",
  "result",
  "same",
  "scene",
  "signal",
  "source",
  "status",
  "summary",
  "tag",
  "text",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "tick",
  "time",
  "timestamp",
  "trigger",
  "true",
  "type",
  "unknown",
  "value",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
])

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function addPart(parts: string[], value: string): void {
  const part = clean(value).slice(0, MAX_VALUE_LENGTH)
  if (part && parts.length < MAX_ITEMS) parts.push(part)
}

function collectText(
  value: unknown,
  parts: string[],
  seen: WeakSet<object>,
  depth = 0,
): void {
  if (parts.length >= MAX_ITEMS || value === null || value === undefined) return

  if (typeof value === "string") {
    addPart(parts, value)
    return
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    addPart(parts, String(value))
    return
  }

  if (typeof value !== "object" || depth >= MAX_DEPTH || seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, parts, seen, depth + 1)
      if (parts.length >= MAX_ITEMS) break
    }
    return
  }

  let keys: string[]
  try {
    keys = Object.keys(value).sort()
  } catch {
    return
  }

  for (const key of keys) {
    try {
      collectText((value as Record<string, unknown>)[key], parts, seen, depth + 1)
    } catch {
      // A hostile getter should not prevent comparison of the remaining memories.
    }
    if (parts.length >= MAX_ITEMS) break
  }
}

function textOf(value: unknown): string {
  const parts: string[] = []
  try {
    collectText(value, parts, new WeakSet())
  } catch {
    return ""
  }
  return clean(parts.join(" ")).slice(0, MAX_CONTEXT_LENGTH)
}

function stem(term: string): string {
  if (term.length > 5 && term.endsWith("sses")) return term.slice(0, -2)
  if (term.length > 5 && term.endsWith("ies")) return `${term.slice(0, -3)}y`
  if (term.length > 6 && term.endsWith("ing")) return term.slice(0, -3)
  if (term.length > 5 && term.endsWith("ed")) return term.slice(0, -2)
  if (term.length > 4 && term.endsWith("s")) return term.slice(0, -1)
  return term
}

function termsOf(text: string): string[] {
  const normalized = text.toLowerCase().normalize("NFKD")
  const matches = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
  const terms: string[] = []
  const seen = new Set<string>()

  for (const match of matches) {
    const numeric = /^\d+$/.test(match)
    if (numeric || match.length < 3 || stopWords.has(match)) continue
    const term = stem(match)
    if (!term || stopWords.has(term) || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }

  return terms
}

function quote(text: string): string {
  const concise = clean(text).slice(0, 160)
  return concise ? `“${concise}${text.length > 160 ? "…”" : "”"}` : "an unlabelled memory"
}

function joinTerms(terms: string[]): string {
  if (terms.length <= 1) return terms[0] ?? "no specific detail"
  if (terms.length === 2) return `${terms[0]} and ${terms[1]}`
  return `${terms.slice(0, -1).join(", ")}, and ${terms.at(-1)}`
}

type Match = {
  index: number
  text: string
  shared: string[]
  score: number
}

function closestMemory(currentTerms: string[], memories: unknown[]): Match | null {
  let best: Match | null = null

  memories.forEach((memory, index) => {
    const text = textOf(memory)
    const memoryTerms = new Set(termsOf(text))
    const shared = currentTerms.filter((term) => memoryTerms.has(term))
    const score = shared.reduce((total, term) => total + Math.min(term.length, 12), shared.length * 10)
    const candidate = { index, text, shared, score }

    if (!best || candidate.score > best.score) best = candidate
  })

  return best
}

async function run(input: Input): Promise<Output> {
  const signalText = input.signals.map(textOf).filter(Boolean).join(" ")
  const triggerText = clean(input.trigger)
  const goalText = clean(input.goal)
  const currentText = clean(`${triggerText} ${signalText}`) || goalText
  const currentTerms = termsOf(currentText)

  if (input.memories.length === 0) {
    return {
      persona: "historian",
      decision: "Build the first comparable memory.",
      priority: "low",
      summary: "No prior memory is available for a reliable callback.",
      evidence: currentText ? [`Current context: ${quote(currentText)}.`] : [],
      directives: [
        "Record the concrete event and its outcome.",
        "Avoid implying that this pattern happened before.",
      ],
      lookup: null,
    }
  }

  if (currentTerms.length === 0) {
    return {
      persona: "historian",
      decision: "Wait for a comparable detail.",
      priority: "low",
      summary: "Memories exist, but the current moment is too vague to compare safely.",
      evidence: [`Available prior memories: ${input.memories.length}.`],
      directives: [
        "Hold the callback until one concrete person, place, action, or outcome appears.",
      ],
      lookup: null,
    }
  }

  const match = closestMemory(currentTerms, input.memories)
  if (!match || match.shared.length === 0) {
    return {
      persona: "historian",
      decision: "Treat the current moment as a new pattern.",
      priority: "low",
      summary: "No meaningful detail overlaps with the available memories.",
      evidence: [
        `Compared ${input.memories.length} prior ${input.memories.length === 1 ? "memory" : "memories"}.`,
        `Current context: ${quote(currentText)}.`,
      ],
      directives: [
        "Do not force a historical callback.",
        "Record the result for a future comparison.",
      ],
      lookup: null,
    }
  }

  const shared = match.shared.slice(0, 4)
  const callbackRequested = /\b(again|before|callback|remember|repeat|same pattern)\b/i.test(
    `${triggerText} ${signalText}`,
  )
  const coverage = match.shared.length / Math.min(currentTerms.length, 8)
  const strongMatch = match.shared.length >= 3 || (match.shared.length >= 2 && coverage >= 0.35)
  const priority: Output["priority"] = strongMatch || callbackRequested ? "high" : "normal"

  return {
    persona: "historian",
    decision: "Connect the current moment to the closest prior memory.",
    priority,
    summary: `A prior memory matches on ${joinTerms(shared)}.`,
    evidence: [
      `Shared details: ${shared.join(", ")}.`,
      `Closest memory #${match.index + 1}: ${quote(match.text)}.`,
    ],
    directives: [
      "Name only the shared details when making the callback.",
      "Contrast the earlier outcome with what is happening now.",
    ],
    lookup: null,
  }
}

export default agent({ inputSchema, outputSchema, tools, run })
