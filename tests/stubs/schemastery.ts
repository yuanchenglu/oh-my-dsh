/** Schemastery 测试 stub：最小实现，满足测试运行时需求 */

export interface Schema<T = unknown> {
  default(value: T): Schema<T>
}

function createSchema<T>(): Schema<T> {
  return {
    default(_value: T) { return createSchema<T>() },
  }
}

export const Schema = {
  object<T>(_shape: Record<string, Schema>): Schema<T> { return createSchema<T>() },
  boolean(): Schema<boolean> { return createSchema<boolean>() },
  string(): Schema<string> { return createSchema<string>() },
  number(): Schema<number> { return createSchema<number>() },
  dict<T>(_valueSchema: Schema<T>): Schema<Record<string, T>> { return createSchema<Record<string, T>>() },
  array<T>(_itemSchema: Schema<T>): Schema<T[]> { return createSchema<T[]>() },
  union<T>(_schemas: Schema[]): Schema<T> { return createSchema<T>() },
}

export default Schema
