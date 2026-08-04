declare module "@guildai/agents-sdk" {
  export type ToolFunction = (input: any) => Promise<any>

  export type Task<Tools extends Record<string, unknown>> = {
    tools: {
      [Name in keyof Tools]: ToolFunction
    }
  }

  export const noTools: Record<string, never>

  export function agent<Definition>(definition: Definition): Definition
}

declare module "@guildai/oceanseth~humanharness-strategist/tool" {
  const tool: unknown
  export default tool
}

declare module "@guildai/oceanseth~humanharness-historian/tool" {
  const tool: unknown
  export default tool
}

declare module "@guildai/oceanseth~humanharness-hypecaster/tool" {
  const tool: unknown
  export default tool
}

declare module "@guildai/oceanseth~humanharness-scout/tool" {
  const tool: unknown
  export default tool
}
