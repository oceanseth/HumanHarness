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
  persona: z.enum(["strategist", "historian", "hypecaster", "scout"]),
  rationale: z.string(),
})
type Output = z.infer<typeof outputSchema>

const tools = { ...noTools }

async function run(input: Input): Promise<Output> {
  const signalText = JSON.stringify(input.signals).toLowerCase()
  const triggerText = input.trigger.toLowerCase()
  const combined = `${triggerText} ${signalText}`

  const scores = {
    strategist: input.trigger === "tick" ? 1 : 4,
    historian: input.memories.length > 0 ? 2 : 0,
    hypecaster: 0,
    scout: 0,
  }

  if (/\b(again|before|remember|repeat|same pattern|callback)\b/.test(combined)) {
    scores.historian += 4
  }
  if (/\b(win|won|victory|clutch|achievement|defeated|knockout|celebrat|hype)\w*\b/.test(combined)) {
    scores.hypecaster += 6
  }
  if (/\b(next|ahead|upcoming|where|when|map|route|schedule|objective|boss|door|path)\b/.test(combined)) {
    scores.scout += 4
  }
  if (input.goal) scores.strategist += 1

  const persona = (Object.entries(scores) as Array<[Output["persona"], number]>)
    .reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]

  return {
    persona,
    rationale: `Highest routing score for the current trigger and ${input.signals.length} recent signal(s).`,
  }
}

export default agent({ inputSchema, outputSchema, tools, run })
