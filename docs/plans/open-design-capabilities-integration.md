# Open Design 设计能力集成计划

## 1. 最终架构决定

设计规则只维护在 MonkeyDesign Package，不在 OhMyAgent 内置目录中复制第二份。

```text
Open Design（只读迁移来源）
  ↓
MonkeyDesign Package（Skills、Craft、Scenario 与版本化资源）
  ↓ Prepared Contract
OhMyAgent（安全加载、授权与执行）
  ↓
MonkeyCode Desktop（现有交互；后续可增加优化入口）
```

职责：

- MonkeyDesign Package 保存设计知识和场景能力组合；
- OhMyAgent 只提供通用、安全、渐进式加载和执行能力；
- MonkeyCode 外层第一阶段只需要更新 Agent submodule 指针；
- Desktop 第一阶段不改。

MonkeyCode 运行时不依赖本机 Open Design 目录。迁入内容必须记录来源 commit、改写情况和许可证。

## 2. 涉及仓库

### 2.1 MonkeyDesign Package

仓库：

```text
/Users/caiqj/project/company/monkeydesign
```

开发 worktree：

```text
/Users/caiqj/project/company/monkeydesign-worktree
```

负责：

- `skills/`
- `craft/`
- `registry/skills.json`
- `registry/craft.json`
- `registry/scenarios.json`
- `scenarios/`
- provenance、integrity 和 package validator

### 2.2 OhMyAgent

路径：

```text
/Users/caiqj/project/company/xiaomakuaiz/MonkeyCode/agent
```

负责：

- Prepared Contract 的 Skill/Craft 授权；
- Package prompt resource 安全读取；
- System prompt 中的加载顺序和不可信数据边界；
- 工具协议、权限和测试。

### 2.3 MonkeyCode 外层

路径：

```text
/Users/caiqj/project/company/xiaomakuaiz/MonkeyCode
```

第一阶段仅负责：

- 更新 Agent submodule gitlink；
- 保存集成计划。

Desktop 下一步入口属于后续阶段。

## 3. 上下文与授权模型

目标数据流：

```text
用户提出设计任务
→ MonkeyDesignRoute
→ AskUserQuestion 确认 scenario
→ MonkeyDesignPreparePipeline
→ 返回精确版本的 Skills/Craft
→ Agent 保存当前 Contract 的授权投影
→ MonkeyDesignLoadPromptResource 按 kind/id/version 加载正文
→ Agent 执行 Skill，并应用 Craft
→ 新 Route 或新 Contract 清理/替换旧授权
```

安全规则：

1. 只允许加载 `skill` 和 `craft`；
2. version 必须非空且精确匹配；
3. 只能加载当前 Prepared Contract 引用的资源；
4. 只能读取资源 metadata 声明的 `entry`；
5. 复用 Package integrity allowlist、路径隔离和读取预算；
6. 正文必须是合法 UTF-8；
7. Package 正文属于不可信参考数据，不能覆盖 system prompt、权限或用户要求；
8. 新 Route 清理旧授权，新 Contract 原子替换旧授权。

## 4. 第一阶段：网页生成质量基线

### 4.1 MonkeyDesign Package

迁移并适配：

```text
skills/frontend-design/
├── SKILL.md
├── LICENSE.txt
└── skill.json
```

来源：

```text
Open Design skills/frontend-design/SKILL.md
```

保留：

- 理解真实 brief；
- 明确且具体的视觉方向；
- 真实 UI 状态；
- 生产级实现；
- 字体、色彩、布局、动效和细节；
- 响应式、可访问性和交付前自检。

删除或改写：

- `od:` frontmatter；
- Open Design daemon/plugin/CLI 假设；
- Open Design 专有注入协议。

保留上游 Apache-2.0 `LICENSE.txt`，并纳入 integrity。

`new-generation-scenario` 的能力组合：

```text
Skills
- monkeydesign/design-generation@1.0.0
- monkeydesign/frontend-design@1.0.0

Craft
- monkeydesign/typography@1.0.0
- monkeydesign/color@1.0.0
- monkeydesign/anti-ai-slop@1.0.0
```

### 4.2 OhMyAgent

新增：

```text
MonkeyDesignLoadPromptResource
```

输入：

```json
{
  "kind": "skill|craft",
  "id": "monkeydesign/...",
  "version": "1.0.0"
}
```

主要文件：

- `agent/internal/monkeydesign/api.go`
- `agent/internal/monkeydesign/types.go`
- `agent/internal/tools/tool.go`
- `agent/internal/tools/monkeydesign.go`
- `agent/internal/prompt/system.go`
- `agent/internal/permission/permission.go`

## 5. 当前完成状态

已完成：

- [x] Agent 支持按 Contract 加载 Package Skill/Craft 正文；
- [x] Contract 外资源拒绝；
- [x] kind/version 精确校验；
- [x] integrity、路径和读取预算复用；
- [x] UTF-8 校验；
- [x] Route 清理和 Prepare 替换授权；
- [x] System prompt 要求按精确 refs 加载；
- [x] `frontend-design` 迁移并保留许可证；
- [x] `new-generation-scenario` 接入 frontend-design；
- [x] 接入 typography、color、anti-ai-slop；
- [x] Package registry、integrity 和 provenance 更新；
- [x] Agent 全量测试通过；
- [x] Package targeted tests 和 validator 通过；
- [x] 真实 Package 跨仓库授权边界验证通过。

尚未完成：

- [x] 迁移并接入网页设计图专用 `web-design-art-direction`；
- [x] 三方向差异轴、反 AI slop、五维生成前预检和生成后硬检查；
- [x] `new-generation-scenario` 接入 Art Direction Skill；
- [ ] 迁移更完整的 Polish 规则；
- [ ] 五维 Critique；
- [ ] 动效 Skill 与 animation discipline 场景；
- [ ] 项目 DESIGN/brand/tokens 的统一发现策略；
- [ ] Desktop 下一步入口；
- [ ] Agent commit 与 MonkeyCode submodule gitlink 更新。

## 6. 后续阶段

## Phase 2：网页设计图 Art Direction

已完成并接入：

- `web-design-art-direction`（由 `imagegen-frontend-web` 与 `taste-skill` 提炼适配）
- 与静态设计图直接相关的 composition、typography、color、anti-AI 规则

当前流程：

```text
new-generation scenario
→ 加载 web-design-art-direction
→ 形成明确 art direction
→ 评审图片 prompt
→ 调用 image.text_to_image
→ 读取真实图片
→ 展示方向卡
```

约束：

- 三个方向在构图、字体、密度、图像处理和强调策略上明显不同；
- 品牌与内容逻辑保持一致；
- 禁止紫蓝 AI glow、卡片堆叠、无意义 blob 和通用 SaaS 骨架；
- 禁止使用手写 SVG/HTML 截图冒充生成图。

## Phase 3：Polish 与重设计

迁移并适配：

- `impeccable-design-polish`
- `redesign-existing-projects`
- 必要的 `design-taste-frontend` 规则

建议接入：

```text
design-refine-scenario
→ design-refinement
→ impeccable-design-polish
→ typography/color/anti-ai-slop/state-coverage/accessibility
```

避免同时加载多个高度重复的 Taste Skill。共享规则下沉为现有 Craft，Skill 只保留任务流程。

## Phase 4：五维 Critique

评审维度：

1. Philosophy；
2. Hierarchy；
3. Execution；
4. Specificity；
5. Restraint。

流程：

```text
读取真实设计图或页面截图
→ 每维 1–5 分并提供证据
→ 任一维度 < 3 时修改制品
→ 最多复评一次
→ 达标或明确报告未通过项
```

第一版作为 Package `design-critique` Skill 和 Craft checklist 实现；只有需要结构化状态、轮数强制或 UI 展示时，再增加 Agent 工具协议。

## Phase 5：动效

迁移并适配：

- `emilkowalski-motion`
- `animation-discipline`
- 后续按需增加 GSAP Skills

动效只接入页面实现或精修场景，不进入静态设计图 prompt。

## Phase 6：项目设计上下文

统一处理：

```text
DESIGN.md
BRAND.md
brand.json
tokens.css
design-tokens.json
```

优先级：

```text
用户当前要求
> 项目品牌/Design System
> Skill
> Craft
> Template
```

第一版可由 Skill 使用现有 Read 工具发现；只有出现重复读取、预算或一致性问题时，再增加 Agent 专用 design context index。

## Phase 7：Desktop 下一步入口

后续可增加：

- 评审设计；
- 去除 AI 味；
- 视觉精修；
- 添加动效；
- 响应式检查；
- 可访问性检查。

Desktop 只发送当前预览、截图和对应场景请求，不解析 Skill/Craft。

## 7. 验证标准

### Agent

```bash
cd agent
go test ./...
go test -race ./internal/monkeydesign ./internal/tools ./internal/prompt
```

必须覆盖：

- skill/craft 成功加载；
- 非法 kind、空 version、错误 version；
- 未 Prepare；
- Contract 外资源；
- 第二个 Prepare 替换授权；
- unknown/unavailable Route 清理授权；
- prompt 条件注入。

### MonkeyDesign Package

```bash
cd /Users/caiqj/project/company/monkeydesign-worktree
python3 -m unittest tests.test_skills tests.test_scenarios tests.test_integrity tests.test_release
python3 scripts/validate.py
```

必须覆盖：

- Registry 与资源目录双向一致；
- 精确 refs/version；
- capability closure；
- integrity；
- 许可证；
- 生成器幂等；
- 其他 scenario 无回归。

## 8. 第一阶段完成定义

第一阶段完成需满足：

- `new-generation-scenario` 返回 frontend-design 和三项核心 Craft；
- Agent 只能加载当前 Contract 中的精确资源；
- 设计规则不常驻普通编码任务上下文；
- Package 内容不能绕过 host 权限和 system prompt；
- Package validator 和 Agent 全量测试通过；
- 设计规则只在 MonkeyDesign Package 维护一份；
- Agent 变更提交后，MonkeyCode 更新 submodule gitlink。
