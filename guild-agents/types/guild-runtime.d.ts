type HumanHarnessAgentInput = {
  trigger: string
  goal: string
  signals: unknown[]
  memories: unknown[]
}

type HumanHarnessPersona = "strategist" | "historian" | "hypecaster" | "scout"

type HumanHarnessSpecialistBrief<Persona extends HumanHarnessPersona> = {
  persona: Persona
  decision: string
  priority: "low" | "normal" | "high"
  summary: string
  evidence: string[]
  directives: string[]
  lookup: string | null
}

declare module "@guildai/agents-sdk" {
  export type AgentTool<Input, Output> = {
    readonly __guildInput?: Input
    readonly __guildOutput?: Output
  }

  export type Task<Tools extends Record<string, unknown>> = {
    tools: {
      [Name in keyof Tools]: Tools[Name] extends AgentTool<infer Input, infer Output>
        ? (input: Input) => Promise<Output>
        : never
    }
  }

  export const noTools: Record<string, never>

  export function agent<Definition>(definition: Definition): Definition
}

declare module "@guildai/human-harness~humanharness-strategist/tool" {
  const tool: import("@guildai/agents-sdk").AgentTool<
    HumanHarnessAgentInput,
    HumanHarnessSpecialistBrief<"strategist">
  >
  export default tool
}

declare module "@guildai/human-harness~humanharness-historian/tool" {
  const tool: import("@guildai/agents-sdk").AgentTool<
    HumanHarnessAgentInput,
    HumanHarnessSpecialistBrief<"historian">
  >
  export default tool
}

declare module "@guildai/human-harness~humanharness-hypecaster/tool" {
  const tool: import("@guildai/agents-sdk").AgentTool<
    HumanHarnessAgentInput,
    HumanHarnessSpecialistBrief<"hypecaster">
  >
  export default tool
}

declare module "@guildai/human-harness~humanharness-scout/tool" {
  const tool: import("@guildai/agents-sdk").AgentTool<
    HumanHarnessAgentInput,
    HumanHarnessSpecialistBrief<"scout">
  >
  export default tool
}
