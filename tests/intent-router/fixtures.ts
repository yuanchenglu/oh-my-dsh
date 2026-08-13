import type { Intent } from '../../src/shared/types.js'

export interface Fixture {
  input: string
  expectedIntent: Intent
  minConfidence: number
}

export const fixtures: Fixture[] = [
  // refactor（fixtures[0-3]）
  { input: '帮我重构这个模块，拆分成更小的函数', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: '把这个大类拆分成几个小类', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: 'refactor the authentication module', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: '迁移数据库到新的 schema', expectedIntent: 'refactor', minConfidence: 0.5 },
  // new（fixtures[4-6]）
  { input: '从零开始创建一个新的 API 服务', expectedIntent: 'new', minConfidence: 0.5 },
  { input: '新建一个 React 项目', expectedIntent: 'new', minConfidence: 0.5 },
  { input: 'create a new microservice', expectedIntent: 'new', minConfidence: 0.5 },
  // medium（fixtures[7-9]）
  { input: '在用户表中添加一个邮箱字段', expectedIntent: 'medium', minConfidence: 0.5 },
  { input: '修改登录页面的样式', expectedIntent: 'medium', minConfidence: 0.5 },
  { input: 'add a new endpoint to the API', expectedIntent: 'medium', minConfidence: 0.5 },
  // collaboration（fixtures[10-11]）
  { input: '把这个任务分派给多个 Agent 并行处理', expectedIntent: 'collaboration', minConfidence: 0.5 },
  { input: '协作完成这个功能开发', expectedIntent: 'collaboration', minConfidence: 0.5 },
  // architecture（fixtures[12-14]）
  { input: '设计一个微服务架构方案', expectedIntent: 'architecture', minConfidence: 0.5 },
  { input: '系统选型和架构设计', expectedIntent: 'architecture', minConfidence: 0.5 },
  { input: 'design the system architecture', expectedIntent: 'architecture', minConfidence: 0.5 },
  // research（fixtures[15-17]）
  { input: '调研一下市面上主流的 Agent 框架', expectedIntent: 'research', minConfidence: 0.5 },
  { input: '分析这个库的源码实现', expectedIntent: 'research', minConfidence: 0.5 },
  { input: 'compare different database solutions', expectedIntent: 'research', minConfidence: 0.5 },
  // simple（fixtures[18-19]）
  { input: '修复这个 typo', expectedIntent: 'simple', minConfidence: 0.5 },
  { input: 'fix this bug in line 42', expectedIntent: 'simple', minConfidence: 0.5 },
  // spec_driven 兜底（fixtures[20-22]）
  { input: '你好', expectedIntent: 'spec_driven', minConfidence: 0.0 },
  { input: 'the', expectedIntent: 'spec_driven', minConfidence: 0.0 },
  { input: '', expectedIntent: 'spec_driven', minConfidence: 0.0 },
]
