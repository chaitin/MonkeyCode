# 贡献指南

欢迎为 MonkeyCode 项目做贡献！本指南将帮助你开始贡献代码。


## 代码提交流程

1. 创建新的功能分支:
```bash
git checkout -b feat/your-feature-name
```

2. 提交代码前请确保:
- 已通过所有测试
- 已格式化代码
- 已更新相关文档

3. 创建 Pull Request:
- 确保 PR 有清晰的标题和描述
- 关联相关 Issue
- 遵循 PR 模板要求

## 代码风格

1. **Go 代码**:
- 使用 gofmt 格式化代码
- 遵循 effective go 指南
- 保持函数简洁 (<80 行)

2. **TypeScript 代码**:
- 使用 ESLint 检查代码
- 遵循标准 React 实践
- 使用 Prettier 格式化

## 测试要求

1. 后端:
- 所有主要功能应有单元测试
- 覆盖率不应低于 80%
- 运行 `make test` 来执行测试

2. 前端:
- 组件应包含基本测试
- 重要交互逻辑应有测试
- 运行 `npm test` 来执行测试

## 其他指南

- 提交消息应清晰且有意义
- 大功能实现应先创建设计文档
- 问题讨论可以在 GitHub Issues 中进行
- 遇到问题随时提问
