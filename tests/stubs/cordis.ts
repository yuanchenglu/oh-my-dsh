/** Cordis 测试 stub：最小实现，满足测试运行时需求 */

export interface Context {
  on(event: string, listener: (...args: any[]) => any): void
  effect(fn: () => (() => void) | void): void
  logger: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
  [key: string]: unknown
}
