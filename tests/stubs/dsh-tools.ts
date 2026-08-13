/** dsh-tools 测试 stub：最小实现，满足测试运行时需求 */

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

export function defineTool(def: ToolDefinition): ToolDefinition {
  return def
}
