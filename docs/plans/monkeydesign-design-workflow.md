# MonkeyDesign 设计流程开发计划

## 1. 背景

当前 MonkeyDesign 已具备 Package 加载、资源路由、Template/Design System 读取和 Pipeline Contract 准备能力，但产品流程仍停留在工具协议层：

- 普通用户会看到或间接接触 Scenario、Pipeline、Contract 等内部概念。
- Template Preview 尚未以图片卡片展示给用户选择。
- 设计图生成和选择尚未形成完整闭环。
- 设计模式尚未作为可提取、保存、版本化和跨项目复用的资产。
- 基于已有项目重新设计时，没有区分“沿用设计模式创建新页面”和“重构整个项目”。

本计划定义面向普通用户的设计流程和实现阶段。设计目标是假设用户不理解内部协议、不愿填写复杂参数，只希望通过少量选择得到稳定的设计结果。

## 2. 核心产品原则

1. Scenario、Pipeline、Contract、task_kind、资源 ID 和版本仅用于内部调试，不在普通用户界面展示。
2. Template、设计模式和设计图都是推荐入口，不强制阻止用户直接开发。
3. Agent 应优先推荐视觉依据，但用户明确要求直接开发时必须允许继续。
4. 从零创建可以选择模板、设计模式、生成设计图或直接开发。
5. 使用设计模式创建新页面时直接开发，不额外生成设计图。
6. 重新设计已有项目时先获取主要信息、选择重构等级，再生成设计图供用户选择。
7. 设计模式的提取过程由 Skills/Atoms 完成，提取结果保存为可复用、可版本化的 Design System 资产。
8. Template 和设计图推荐统一使用“小输入框 + 换一批”交互。
9. 每一步只要求用户做一个容易理解的决定，并提供推荐项。
10. 开发结果必须能够追溯到用户选择的模板、设计模式或设计图。

## 3. 统一推荐交互

### 3.1 组件结构

Template 和设计图使用相同的推荐容器：

```text
┌────────────┐ ┌────────────┐ ┌────────────┐
│ 图片卡 A    │ │ 图片卡 B    │ │ 图片卡 C    │
│ [选择]      │ │ [选择]      │ │ [选择]      │
└────────────┘ └────────────┘ └────────────┘

┌────────────────────────────────────┐
│ 想换成什么风格？不填也可以          │
└────────────────────────────────────┘
[换一批]
```

### 3.2 Template 换一批语义

输入框为空：

- 排除本会话已经展示过的 Template ID。
- 使用原始用户需求请求下一批推荐。

输入框有内容：

- 将输入内容作为新增推荐条件。
- 使用“原始需求 + 用户补充条件”重新推荐。
- 仍排除已经展示过的 Template ID。

### 3.3 设计图换一批语义

输入框为空：

- 基于当前 Brief 重新生成不同方向的设计图。

输入框有内容：

- 将内容作为修改意见。
- 基于原始 Brief、已有设计上下文和修改意见重新生成设计图。

### 3.4 推荐数量

- Template：每批 4～6 个。
- 设计图：每批默认 3 个。
- 不一次性展示全部资源。

## 4. 用户流程

## 4.1 入口判断

Agent 在内部判断当前任务属于：

```text
A. 从零创建
B. 使用设计模式创建新页面
C. 重新设计已有项目
D. 普通开发或局部修改
```

如果无法确定，只询问：

```text
你准备怎么做？

[创建一个新页面]
[重新设计现有项目]
```

普通界面不展示内部 Route 结果。

## 4.2 流程 A：从零创建

### 4.2.1 起点推荐

```text
选择一个起点，通常能获得更好的设计效果

[选择模板]
[选择设计模式]
[先生成设计图]

直接开发
```

前三项是主要操作，“直接开发”是弱化的次要操作。

### 4.2.2 选择模板

1. Agent 根据用户需求推荐 4～6 个相关模板。
2. UI 展示预览图、名称、简短说明、推荐标识和选择按钮。
3. 用户可以填写补充条件并点击“换一批”。
4. 用户选择后显示：

```text
已选择模板：<名称>

[按这个模板开发]
[重新选择]
```

5. 用户确认后进入开发。

### 4.2.3 选择设计模式

用户可以：

```text
[使用已保存的设计模式]
[从 URL 提取]
[从当前项目提取]
```

选中设计模式后直接进入开发，不再生成设计图。

### 4.2.4 先生成设计图

1. Agent 根据用户需求生成 3 张设计图。
2. UI 展示设计图选择卡。
3. 用户可以填写意见并点击“换一批”。
4. 用户选中后显示：

```text
已选择：<设计图名称>

[按这个设计开发]
[重新选择]
```

5. 用户确认后进入开发。

### 4.2.5 直接开发

用户明确选择“直接开发”或通过自然语言表达无需推荐时，Agent 可以直接进入实现，不得强制阻塞。

## 4.3 流程 B：使用设计模式创建新页面

典型用户请求：

```text
按照这个项目现有的风格做一个定价页。
```

### 4.3.1 设计模式解析

如果项目已绑定设计模式：

```text
已找到设计模式：<名称>

[直接使用]
[重新提取]
[选择其他设计模式]
```

默认推荐“直接使用”。

如果项目尚未绑定：

```text
当前项目还没有设计模式

[从当前项目提取]
[选择已保存的设计模式]
[从 URL 提取]
```

### 4.3.2 页面开发

选中设计模式后，用户只需要描述页面用途。Agent 读取设计模式中的规则后直接开发：

```text
选择 designSystemId
→ 加载 DESIGN.md
→ 加载 tokens.css
→ 加载 components manifest
→ 开发新页面
→ 启动预览
```

该流程不生成设计图。

## 4.4 流程 C：重新设计已有项目

典型用户请求：

```text
重新设计这个项目。
```

### 4.4.1 主要信息获取

Agent 自动获取：

- 产品类型和目标用户。
- 核心业务功能。
- 主要页面。
- 必须保留的内容。
- 当前主要页面截图。
- 是否已有设计模式。

该阶段不要求完整理解所有源代码，也不立即修改项目。

### 4.4.2 设计模式处理

如果已经提取过：

```text
已找到设计模式：<名称>

[继续使用]
[重新提取]
[换一种设计模式]
```

如果没有提取过：

```text
[提取当前设计模式]
[跳过，直接生成重构设计图]
```

提取设计模式是推荐项，不是重构前置条件。

### 4.4.3 重构等级

#### 轻度优化

保留页面结构、业务流程、文案和组件结构，只调整颜色、字体、间距和视觉细节。

#### 中度重构（推荐）

保留核心业务、主要内容和品牌资产，允许调整信息层级、页面布局、组件结构、导航和视觉语言。

#### 深度重构

只保留核心产品定位、关键业务功能和必须保留的数据，允许重新设计信息架构、页面结构、交互流程、组件体系和视觉语言。

### 4.4.4 生成重构设计图

Agent 根据以下信息生成 3 张设计图：

- 项目主要信息。
- 当前页面截图。
- 当前或选定的设计模式。
- 用户选择的重构等级。
- 用户补充要求。

用户通过统一推荐容器选择或换一批。选中后显示：

```text
已选择：<设计图名称>
重构等级：<等级>

[按这个方案重构]
[重新选择]
```

确认后才进入项目修改。

## 4.5 流程 D：普通开发或局部修改

以下需求不进入完整设计流程：

- 修复功能 Bug。
- 修改少量文案。
- 调整接口或后端逻辑。
- 修复构建问题。
- 用户明确要求直接开发。

Agent 可以正常使用开发工具，不展示 Template、设计模式或设计图推荐。

## 5. 设计模式模型

## 5.1 概念

“设计模式”是面向用户的产品名称，内部使用 Design System 数据模型。

设计模式包含：

- 名称和说明。
- 来源类型和来源地址。
- 来源指纹。
- 版本历史。
- 颜色、字体和间距 Token。
- 圆角、阴影和边框规则。
- 页面网格和布局节奏。
- 内容密度。
- 组件风格和组件清单。
- 交互和动效规则。
- 品牌资产。
- 桌面端和移动端截图。
- Source Evidence。

## 5.2 提取模型

提取过程由 Skills/Atoms 完成：

```text
code-import
→ design-extract
→ token-map
→ rewrite-plan
```

提取结果保存为 Design System Package：

```text
DESIGN.md
tokens.css
design-tokens.json
tailwind-v4.css
components.html
components.manifest.json
USAGE.md
manifest.json
preview/*
source/*
assets/*
fonts/*
```

## 5.3 来源

支持：

- 当前本地项目。
- 其他本地项目。
- URL。
- 未来支持 GitHub、Figma、上传资产。

## 5.4 保存和复用

每个设计模式应保存：

```text
id
name
sourceType
sourceUrl/sourcePath
sourceFingerprint
createdAt
updatedAt
revisions
defaultPreview
projectBindings
provenance
```

当来源已经提取过时：

```text
已找到保存的设计模式

[直接使用]
[重新提取]
```

如果来源指纹发生变化：

```text
检测到来源已更新

[继续使用已保存版本]
[提取新版本]
```

重新提取创建新 Revision，不直接覆盖旧版本。

## 6. Open Design 迁移范围

参考仓库：

```text
/Users/caiqj/project/company/baizhiyun/open-design
```

## 6.1 优先迁移

### Design System Package 合同

来源：

```text
od-upstream/apps/daemon/src/design-systems/index.ts
od-upstream/design-systems/*
od-upstream/plugins/_official/design-systems/*
```

迁移内容：

- Manifest 数据结构。
- DESIGN.md。
- Tokens。
- Components Manifest。
- Preview、Source 和 Provenance。
- Revision 模型。

### 项目提取 Skills/Atoms

来源：

```text
apps/daemon/src/plugins/atoms/code-import.ts
apps/daemon/src/plugins/atoms/design-extract.ts
apps/daemon/src/plugins/atoms/token-map.ts
apps/daemon/src/plugins/atoms/rewrite-plan.ts
```

迁移时改造成 MonkeyDesign 原生 Skills 或本地工具，保留明确的 JSON/文件输入输出边界。

### Template 推荐能力

来源：

```text
backend/internal/templaterec/index.json
backend/internal/templaterec/index.go
backend/internal/templaterec/service.go
backend/internal/dto/templaterec.go
scripts/build-template-index.mjs
```

迁移内容：

- 推荐索引。
- Surface 过滤。
- `exclude_ids` 换一批协议。
- LLM 推荐 Prompt。
- 关键词降级算法。

### 设计参考卡协议

来源：

```text
od-upstream/apps/web/src/artifacts/design-references.ts
od-upstream/apps/web/src/components/DesignReferencesGrid.tsx
od-upstream/apps/daemon/src/prompts/discovery.ts
```

迁移内容：

```json
{
  "pageSize": 3,
  "items": [
    {
      "id": "...",
      "title": "...",
      "image": "...",
      "description": "..."
    }
  ]
}
```

支持选择、换一批、重新生成和拒绝推荐。

### 五个内置视觉方向

来源：

```text
od-upstream/apps/daemon/src/prompts/directions.ts
```

可作为无 Template、无设计模式时生成设计图的方向参考。

## 6.2 不能直接迁移

- Open Design 整套 React UI。
- Daemon REST API 和数据库。
- 租户系统。
- Plugin Snapshot Runtime。
- Open Design 项目和会话模型。
- Pinterest/图片 Provider。
- Open Design 专属 CLI、MCP 和 Sandbox URL。

这些能力需要按照 MonkeyCode/MonkeyDesign 的协议重新实现。

## 7. 建议领域对象

## 7.1 TemplateRecommendation

```ts
type TemplateRecommendation = {
  id: string;
  version: string;
  title: string;
  description: string;
  preview: ImageAttachment;
  reason?: string;
  confidence?: number;
};
```

## 7.2 DesignReference

```ts
type DesignReference = {
  id: string;
  title: string;
  description?: string;
  image: ImageAttachment;
  generationPrompt?: string;
};
```

## 7.3 DesignPattern

```ts
type DesignPattern = {
  id: string;
  name: string;
  revision: string;
  source: DesignPatternSource;
  fingerprint?: string;
  manifestPath: string;
  previews: ImageAttachment[];
  provenance: Provenance;
};
```

## 7.4 DesignStartChoice

```ts
type DesignStartChoice =
  | { kind: "template"; templateId: string; version: string }
  | { kind: "design-pattern"; patternId: string; revision: string }
  | { kind: "design-reference"; referenceId: string }
  | { kind: "direct" };
```

## 7.5 RedesignLevel

```ts
type RedesignLevel = "light" | "medium" | "deep";
```

## 8. Agent 与 MonkeyCode 协议建议

普通 AskUserQuestion 不支持图片，Template 和设计图选择需要独立协议。

建议增加：

```text
design/start-choice/request
design/template-selection/request
design/reference-selection/request
design/pattern-selection/request
design/redesign-level/request
design/selection/respond
design/selection/cancelled
```

请求至少包含：

```ts
type DesignSelectionRequest = {
  requestId: string;
  sessionId: string;
  title: string;
  description?: string;
  items: Array<{
    id: string;
    title: string;
    description?: string;
    image?: ImageAttachment;
    recommended?: boolean;
  }>;
  refinement?: {
    placeholder: string;
    actionLabel: "换一批";
  };
};
```

响应：

```ts
type DesignSelectionResponse = {
  requestId: string;
  selectedId?: string;
  refinementText?: string;
  action: "select" | "next" | "direct" | "cancel";
};
```

## 9. 开发阶段

## Phase 1：Template 图片选择闭环

- Package Template Preview 输出。
- Template 推荐索引。
- 输入框 + 换一批。
- 图片卡片选择协议。
- MonkeyCode Template Gallery。
- 选择后绑定 Template 并继续开发。

验收：用户可以看到图片、换一批、输入条件重新推荐并选中模板。

## Phase 2：设计模式 Package 和本地项目提取

- 迁移 Design System Package 合同。
- 迁移 code-import、design-extract、token-map。
- 从当前项目生成设计模式。
- 设计模式保存、Revision 和项目绑定。
- 设计模式选择 UI。

验收：同一项目第二次使用时可以直接复用已保存设计模式。

## Phase 3：URL 设计模式提取

- URL 抓取和浏览器回退。
- HTML、CSS、品牌资产和截图采集。
- 生成 Design System Package。
- 来源指纹和重新提取。

验收：同一 URL 可以直接复用或创建新 Revision。

## Phase 4：设计图生成与选择

- 设计图生成 Provider 接入。
- 三图选择协议。
- 输入框 + 换一批。
- 设计图附件保存。
- 选择后绑定 DesignReference。

验收：从零创建可以先生成设计图，选择后继续开发。

## Phase 5：已有项目重构流程

- 自动获取项目主要信息和截图。
- 设计模式复用/提取入口。
- 轻度、中度、深度重构选择。
- 基于重构等级生成设计图。
- 选择设计图后执行重构计划。

验收：项目修改前必须完成重构等级和设计图选择，除非用户明确直接开发。

## Phase 6：视觉回归闭环

- 将用户选择的 Template/设计模式/设计图写入实现上下文。
- 生成页面后自动截图。
- 与视觉依据对比。
- 自动修正明显偏差。
- 接入现有截图、标注和元素反馈工作台。

验收：最终实现能够追溯到用户选择的视觉依据，并支持反馈迭代。

## 10. 测试计划

每个 Phase 均需要：

- Agent 单元测试。
- stdio 协议测试。
- MonkeyCode reducer 测试。
- 图片附件和丢失资源测试。
- 用户取消、换一批和重复响应测试。
- Debug 桌面端真实交互测试。

重点流程：

```text
模板：推荐 → 输入条件 → 换一批 → 选择 → 开发
设计模式：提取 → 保存 → 复用 → 创建新页面
设计图：生成 → 输入意见 → 换一批 → 选择 → 开发
重构：读取主要信息 → 选择等级 → 设计图 → 选择 → 重构
直接开发：拒绝推荐 → 正常开发
```

## 11. 风险与约束

1. Template 和 Design System 必须保持正交：Template 控制结构，设计模式控制视觉规则。
2. URL 提取需要处理反爬、登录态、跨域资源和授权边界。
3. 图片生成 Provider 尚未纳入当前 MonkeyDesign Runtime。
4. Open Design 的代码和资源需要确认许可证、品牌和资产使用范围。
5. 图片选择不能继续复用纯文本 AskUserQuestion，需要专用协议。
6. 设计模式提取结果必须保留 Source Evidence，避免模型编造 Token。
7. 推荐流程不能阻塞用户明确的直接开发请求。
8. 重新生成必须清晰区分“已有结果本地翻页”和“真正重新调用推荐/生成”。

## 12. 非目标

本计划暂不包含：

- 直接迁移 Open Design 完整 UI。
- 直接运行 Open Design Plugin Pipeline。
- Figma 双向同步。
- 设计模式公开市场。
- 多人协作和组织级权限。
- 自动发布或生产部署。

## 13. 设计会话状态机

设计流程不能只依赖模型记忆，需要由 Agent 保存明确状态。建议状态：

```ts
type DesignFlowState =
  | { stage: "idle" }
  | { stage: "start-recommended"; brief: string }
  | { stage: "template-selecting"; brief: string; seenIds: string[] }
  | { stage: "pattern-selecting"; brief: string }
  | { stage: "pattern-extracting"; source: DesignPatternSource }
  | { stage: "reference-generating"; brief: string; generation: number }
  | { stage: "reference-selecting"; references: DesignReference[] }
  | { stage: "redesign-level-selecting"; projectSnapshot: ProjectSnapshot }
  | { stage: "development-ready"; choice: DesignStartChoice }
  | { stage: "implementing"; choice: DesignStartChoice }
  | { stage: "reviewing"; choice: DesignStartChoice };
```

### 13.1 状态转换

```text
idle
→ start-recommended
→ template-selecting / pattern-selecting / reference-generating / development-ready

pattern-selecting
→ pattern-extracting（需要提取时）
→ development-ready

reference-generating
→ reference-selecting
→ development-ready

redesign-level-selecting
→ reference-generating
→ reference-selecting
→ development-ready

用户明确直接开发
→ development-ready(choice=direct)
```

### 13.2 状态约束

- 同一 Session 同时只能存在一个等待用户响应的设计选择请求。
- 迟到、重复或已取消的响应必须拒绝。
- “换一批”不会覆盖已选择结果，除非用户明确重新选择。
- 新一轮设计任务开始时归档旧状态，不静默复用旧选择。
- 普通 Bug 修复不应重置当前项目绑定的设计模式。
- 用户可以随时退出推荐流程并选择直接开发。

## 14. Agent 决策规则

## 14.1 从零创建

满足以下表达时优先推荐流程 A：

```text
从零创建
新建页面
设计一个页面/网站/UI
做一个产品官网/落地页/控制台
```

推荐顺序不固定，Agent 根据资源匹配度调整：

- 有高置信度 Template：优先推荐“选择模板”。
- 项目已绑定设计模式：优先推荐“使用设计模式”。
- 用户强调独特、定制或先看效果：优先推荐“先生成设计图”。
- 用户强调速度或明确不要选择：突出“直接开发”。

## 14.2 使用设计模式创建新页面

满足以下表达时进入流程 B：

```text
按照现有风格增加页面
保持当前设计语言
参考这个 URL 的风格开发
使用我之前保存的设计模式
```

Agent 先解析设计模式来源，再直接开发，不生成设计图。

## 14.3 重新设计已有项目

满足以下表达时进入流程 C：

```text
重新设计这个项目
重构现有界面
整个产品换一套视觉
保留功能但重新做 UI
```

Agent 只收集足以生成重构设计图的主要信息，不先进行完整代码迁移。

## 14.4 普通修改

以下请求不主动推荐完整设计流程：

```text
修复某个交互 Bug
调整一个按钮
修改一句文案
修复响应式溢出
替换一个图标
```

如果用户在普通修改中明确要求探索视觉方向，可以再进入推荐流程。

## 15. UI 详细规格

## 15.1 图片卡

每张卡片包含：

- 预览图。
- 名称。
- 最多两行说明。
- 可选推荐标记。
- 选择按钮。
- 选中状态。

不展示内部 ID 和版本；Debug 模式可在详情中查看。

## 15.2 换一批输入框

Template Placeholder：

```text
想换成什么风格？不填也可以
```

设计图 Placeholder：

```text
希望怎么调整？不填也可以
```

行为：

- Enter 与“换一批”等价。
- 请求进行中禁止重复提交。
- 保留用户输入，便于继续调整。
- 提供清空按钮。
- 请求失败时保留当前卡片和输入内容。

## 15.3 直接开发

“直接开发”作为文本按钮或次要按钮展示，不与推荐入口争夺主视觉层级。

点击后应直接进入开发，不再弹出二次确认；Agent 在实现摘要中注明用户跳过了视觉推荐。

## 15.4 设计模式卡

展示：

- 名称。
- 来源：项目或 URL。
- Preview。
- 更新时间。
- 是否为当前项目默认模式。
- “使用”“重新提取”“查看版本”操作。

## 15.5 重构等级卡

三张卡固定排序：

```text
轻度优化
中度重构（推荐）
深度重构
```

每张卡只展示“保留什么”和“允许改变什么”，不展示内部 Pipeline 信息。

## 16. 数据持久化与所有权

## 16.1 用户级数据

用户设计模式库保存：

- Design Pattern Package。
- Revision。
- 来源和指纹。
- Preview。
- 用户自定义名称。
- 最近使用时间。

## 16.2 项目级数据

项目保存引用，不复制完整设计模式：

```ts
type ProjectDesignBinding = {
  projectId: string;
  designPatternId?: string;
  designPatternRevision?: string;
  templateId?: string;
  templateVersion?: string;
  selectedReferenceId?: string;
  redesignLevel?: RedesignLevel;
};
```

## 16.3 会话级数据

会话保存当前选择流程和临时推荐结果：

- Brief。
- 已展示 Template ID。
- Refinement 输入。
- 当前设计图批次。
- 当前选择请求 ID。
- 用户选择结果。

临时未选择的图片可以按 TTL 回收；已选择图片需要转为项目制品。

## 17. 仓库职责划分

## 17.1 monkeydesign-worktree

负责静态、可版本化的设计资源：

- Template Registry 和 Preview。
- Design System Package Schema。
- Skills、Atoms、Scenarios 和 Pipelines。
- 五个内置方向资源。
- 资源引用和完整性约束。

不负责用户数据库、Session 状态和桌面 UI。

## 17.2 ohmyagent-monkeydesign

负责设计编排和工具协议：

- 识别设计任务入口。
- Template 推荐和换一批。
- 设计模式提取工具。
- 设计图生成工具调用。
- 设计状态机。
- stdio 选择请求与响应。
- 将选中的视觉依据注入实现上下文。

## 17.3 MonkeyCode

负责宿主 UI 和本地制品：

- Template Gallery。
- 设计模式选择器。
- 设计图选择器。
- 输入框 + 换一批。
- 重构等级卡。
- 图片附件存储和展示。
- 选择响应。
- 设计预览、截图、标注和反馈。

## 18. Open Design 迁移清单

迁移前逐项确认来源许可证和依赖。

| 能力 | Open Design 来源 | MonkeyDesign 目标 | 方式 |
|---|---|---|---|
| Design System Package | `apps/daemon/src/design-systems/index.ts` | Package Schema | 重写数据模型 |
| 本地代码扫描 | `plugins/atoms/code-import.ts` | Skill/Tool | 迁移算法 |
| 设计规则提取 | `plugins/atoms/design-extract.ts` | Skill/Tool | 迁移算法 |
| Token 映射 | `plugins/atoms/token-map.ts` | Skill/Tool | 迁移算法 |
| Rewrite Plan | `plugins/atoms/rewrite-plan.ts` | Redesign Skill | 迁移合同和算法 |
| Template 推荐索引 | `backend/internal/templaterec` | 推荐服务 | 迁移索引和降级算法 |
| 换一批排除协议 | `exclude_ids` | Session Recommendation State | 直接采用语义 |
| 五个方向 | `prompts/directions.ts` | Direction Resources | 迁移静态数据 |
| 设计参考卡 | `DesignReferencesGrid.tsx` | MonkeyCode Gallery | 重写 UI，保留协议 |
| URL 品牌提取 | `/api/brands` 流程 | URL Extract Skill | 重写 Runtime |

## 19. 里程碑与依赖

```text
M1 Template Gallery
  ↓
M2 Design Pattern Package + 本地提取
  ↓
M3 设计模式保存和复用
  ↓
M4 URL 提取
  ↓
M5 设计图生成与选择
  ↓
M6 已有项目重构
  ↓
M7 视觉回归
```

可并行关系：

- M1 的 Gallery UI 可以与 M2 的 Package Schema 并行。
- M4 依赖 M2、M3。
- M5 可在 M4 之前开发，但依赖图片附件和选择协议。
- M6 依赖 M2、M3、M5。
- M7 依赖 M1、M5、M6 和现有预览工作台。

## 20. Definition of Done

完整设计流程达到可交付状态必须满足：

### Template

- 用户能看到真实预览图。
- 用户能输入条件并换一批。
- 已看过模板不会立即重复。
- 选中模板能够稳定进入开发。

### 设计模式

- 能从本地项目提取。
- 能从 URL 提取。
- 能保存、复用和创建 Revision。
- 选中后创建新页面不要求生成设计图。

### 设计图

- 能一次生成 3 张。
- 能根据输入意见换一批。
- 选择结果能够持久化。
- 开发结果能够关联选择的设计图。

### 重构

- 能获取项目主要信息和截图。
- 能选择轻度、中度、深度等级。
- 能基于等级生成设计图。
- 用户确认前不修改项目；用户选择直接开发时除外。

### 宿主体验

- 普通用户不需要理解 Scenario、Pipeline 和资源 ID。
- 推荐流程可随时退出。
- 失败不会丢失当前选择和输入。
- 重复、过期和取消响应不会推进状态机。
- Debug 模式可以查看完整内部协议信息。

## 21. 待确认决策

以下内容需要在实施前最终确定：

1. 第一版设计图使用真实图片生成 Provider，还是先用 HTML 原型截图。
2. 设计模式库保存在本机、Agent 配置目录，还是 MonkeyCode 数据目录。
3. URL 提取第一版是否支持登录态页面。
4. Template Gallery 放在聊天流内，还是预览工作台的独立区域。
5. 设计图和 Template Preview 的缓存目录及 TTL。
6. 用户选择直接开发后，是否仍在结果页提供“补选视觉依据”入口。
7. 深度重构第一版支持单个关键页面，还是支持多页面批量设计图。
