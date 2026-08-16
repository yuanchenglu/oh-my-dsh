// Type stubs for @deepseek-ai peer dependencies.
// These packages are not installed as devDependencies (they are provided by the dsh runtime).
// We declare minimal types here so tsc --noEmit passes in isolation.

declare module '@deepseek-ai/cordis' {
  export interface Context {
    on(event: string, listener: (...args: never[]) => unknown): void
    effect(fn: () => (() => void) | void): void
    get(name: string, strict?: boolean): unknown
    logger: {
      info(...args: unknown[]): void
      warn(...args: unknown[]): void
      error(...args: unknown[]): void
    }
    llm: {
      resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{
        reasoning?: { efforts: readonly { id: string }[]; defaultEffort?: string }
      }>
    }
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-session' {
  export interface SessionHeader {
    id: string
    cwd?: string
    parentSession?: string
  }

  export interface Session {
    readonly header: SessionHeader
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export interface LlmModelReasoningInfo {
    efforts: readonly { id: string }[]
    defaultEffort?: string
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>
    output?: {
      schema: Record<string, unknown>
      render?: (args: unknown, value: unknown) => Array<{ type: string; text: string }>
    }
    execute(args: Record<string, unknown>): Promise<unknown>
  }

  export function defineTool(def: ToolDefinition): ToolDefinition
}

declare module '@deepseek-ai/schemastery' {
  export interface Schema<T = unknown> {
    default(value: T): Schema<T>
  }

  export const Schema: {
    object<T>(shape: Record<string, Schema>): Schema<T>
    boolean(): Schema<boolean>
    string(): Schema<string>
    number(): Schema<number>
    dict<T>(valueSchema: Schema<T>): Schema<Record<string, T>>
    array<T>(itemSchema: Schema<T>): Schema<T[]>
    union<T>(schemas: Schema[]): Schema<T>
  }

  export default Schema
}
