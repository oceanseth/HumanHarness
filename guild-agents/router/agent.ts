"use agent"

import { agent, type Task } from "@guildai/agents-sdk"
import historianTool from "@guildai/human-harness~humanharness-historian/tool"
import hypecasterTool from "@guildai/human-harness~humanharness-hypecaster/tool"
import scoutTool from "@guildai/human-harness~humanharness-scout/tool"
import strategistTool from "@guildai/human-harness~humanharness-strategist/tool"
import { z } from "zod"

const personas = ["strategist", "historian", "hypecaster", "scout"] as const
type Persona = (typeof personas)[number]

const inputSchema = z.object({
  trigger: z.string(),
  goal: z.string(),
  signals: z.array(z.unknown()),
  memories: z.array(z.unknown()),
})
type Input = z.infer<typeof inputSchema>

const briefSchema = z.object({
  persona: z.enum(personas),
  decision: z.string(),
  priority: z.enum(["low", "normal", "high"]),
  summary: z.string(),
  evidence: z.array(z.string()),
  directives: z.array(z.string()),
  lookup: z.string().nullable(),
})

const outputSchema = z.object({
  persona: z.enum(personas),
  specialist: z.enum(personas),
  rationale: z.string(),
  brief: briefSchema,
})
type Output = z.infer<typeof outputSchema>

const tools = {
  strategist: strategistTool,
  historian: historianTool,
  hypecaster: hypecasterTool,
  scout: scoutTool,
}
type Tools = typeof tools

const textFor = (value: unknown): string => {
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return String(value).toLowerCase()
  }
}

export function selectSpecialist(input: Input): {
  persona: Persona
  rationale: string
} {
  const latestSignals = input.signals.slice(-1)
  const combined = `${input.trigger.toLowerCase()} ${input.goal.toLowerCase()} ${textFor(latestSignals)}`
  const scores: Record<Persona, number> = {
    strategist: input.trigger === "tick" ? 1 : 4,
    historian: input.memories.length > 0 ? 2 : 0,
    hypecaster: 0,
    scout: 0,
  }

  if (/\b(again|before|remember|repeat|same pattern|callback)\b/.test(combined)) {
    scores.historian += 6
  }
  if (/\b(win|won|victory|clutch|achievement|defeated|knockout|celebrat|hype)\w*\b/.test(combined)) {
    scores.hypecaster += 8
  }
  if (
    /\b(next|ahead|upcoming|where|when|map|route|schedule|door|path|lookup|research|search|investigate|recon)\b/.test(
      combined,
    )
  ) {
    scores.scout += 6
  }
  if (input.goal.trim()) scores.strategist += 1

  const persona = (Object.entries(scores) as Array<[Persona, number]>).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
  )[0]

  return {
    persona,
    rationale: `Dispatched to the ${persona} agent from deterministic routing scores for ${input.signals.length} signal(s) and ${input.memories.length} recalled memory item(s).`,
  }
}

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  const selection = selectSpecialist(input)
  let brief: z.infer<typeof briefSchema>

  switch (selection.persona) {
    case "historian":
      brief = await task.tools.historian(input)
      break
    case "hypecaster":
      brief = await task.tools.hypecaster(input)
      break
    case "scout":
      brief = await task.tools.scout(input)
      break
    default:
      brief = await task.tools.strategist(input)
      break
  }

  if (brief.persona !== selection.persona) {
    throw new Error(`The ${selection.persona} tool returned a ${brief.persona} brief`)
  }

  return {
    persona: selection.persona,
    specialist: selection.persona,
    rationale: selection.rationale,
    brief,
  }
}

export default agent({ inputSchema, outputSchema, tools, run })
