import type { Strategies } from '../shared/types.js'

/** 7+1 意图策略绑定表（从 oh-my-deepseek-harness strategies.yaml 移植） */
export const strategies: Strategies = {
  refactor: {
    description: '在已有代码基础上改变结构而不改变外部行为',
    keywords: ['重构', '拆', '拆分', '迁移', 'restructure', 'refactor', '模块拆分', '重组', '重写'],
    common_creep: ['不新增功能', '不修改 API 契约', '不引入新依赖', '不改数据库 schema'],
  },
  new: {
    description: '从零开始构建新项目或新功能',
    keywords: ['新建', '从零', '创建', 'new', 'create', '项目', '初始化', '生成'],
    common_creep: ['不加权限系统', '不加 OAuth', '不加多租户', '不加 CI/CD'],
  },
  medium: {
    description: '在现有项目中添加或修改中等规模功能',
    keywords: ['添加', '修改', '更新', '增加', 'add', 'modify', '功能', '扩展', 'endpoint'],
    common_creep: [],
  },
  collaboration: {
    description: '多 Agent 或人机协作',
    keywords: ['协作', '多人', '分派', '并行', 'collaborate', 'parallel', 'team', '分工', '完成'],
    common_creep: ['不急的优化', '不要额外协调轮次'],
  },
  architecture: {
    description: '系统级架构设计和决策',
    keywords: ['架构', '设计', '选型', 'architecture', 'design', 'system', '系统', '方案'],
    common_creep: [],
  },
  research: {
    description: '探索性任务，产出知识和建议',
    keywords: ['调研', '分析', '探索', 'research', 'analyze', '研究', '对比', '评估', 'compare'],
    common_creep: [],
  },
  simple: {
    description: '单文件或极少文件的明确修改',
    keywords: ['修复', '改', 'bug', 'fix', 'typo', '一行', '小改'],
    common_creep: [],
  },
  spec_driven: {
    description: '基于结构化 Spec 推导策略（兜底）',
    keywords: [],
    common_creep: [],
  },
}
