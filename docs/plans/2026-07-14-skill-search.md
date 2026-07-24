# 任务 Skills 检索功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 为普通用户创建任务时使用的共享 Skills 选择弹窗增加即时检索功能。

**架构：** 在共享 `TaskSkillSelector` 内保存搜索关键词，并在现有标签过滤前增加名称、描述和标签匹配。三个调用方继续负责加载和选择 Skills，无需修改 API、调用方接口或持久化数据。

**技术栈：** React、TypeScript、Vite、项目现有 UI 组件、react-i18next。

## 全局约束

- 搜索覆盖 Skill 名称、描述和标签。
- 搜索忽略大小写和关键词首尾空白。
- 搜索结果与当前标签取交集，并保持原始顺序。
- 关闭弹窗时清空搜索关键词。
- 保持默认 Skill、强制下发 Skill 和选择状态的现有行为。
- 不新增依赖和后端 API。
- 项目没有前端单元测试脚本，通过 `pnpm lint`、`pnpm run build:online` 和三个入口的人工预览验证。
- 用户明确下达提交指令前不执行 `git commit`。

---

### 任务 1：实现共享 Skills 选择器检索

**文件：**
- 修改：`frontend/src/components/console/task/task-skill-selector.tsx`
- 修改：`frontend/src/i18n/resources/cn.ts`
- 修改：`frontend/src/i18n/resources/en.ts`

**接口：**
- 使用现有 `TaskSkillSelectorProps.skills: SkillForPicker[]`。
- 保持 `TaskSkillSelectorProps` 对外接口不变。
- 产出组件内部 `searchQuery: string` 状态和 `matchesSearch(skill): boolean` 判断。

- [x] **步骤 1：增加搜索状态、规范化和关闭清理**

在 `TaskSkillSelector` 中增加内部状态，并在 `open` 变为 `false` 时清空关键词：

```tsx
const [searchQuery, setSearchQuery] = useState("")
const normalizedSearchQuery = searchQuery.trim().toLowerCase()

useEffect(() => {
  if (!open) {
    setSearchQuery("")
  }
}, [open])
```

- [x] **步骤 2：增加名称、描述和标签匹配函数**

空关键词匹配全部 Skills；有关键词时对三个用户可见字段做包含匹配：

```tsx
const matchesSearch = (skill: SkillForPicker) => {
  if (!normalizedSearchQuery) {
    return true
  }

  return [skill.name || "", skill.description || "", ...(skill.tags || [])]
    .some((value) => value.toLowerCase().includes(normalizedSearchQuery))
}
```

- [x] **步骤 3：在标签栏上方增加搜索框**

导入现有 `Input` 和 `IconSearch`，在 `Tabs` 内、标签栏之前渲染：

```tsx
<div className="relative mb-2">
  <IconSearch className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
  <Input
    value={searchQuery}
    onChange={(event) => setSearchQuery(event.target.value)}
    placeholder={t("taskWorkflow.skill.searchPlaceholder")}
    aria-label={t("taskWorkflow.skill.searchPlaceholder")}
    className="h-11 pl-8 md:h-8"
  />
</div>
```

- [x] **步骤 4：组合搜索和标签条件并显示空结果**

每个标签页先排除强制下发 Skill，再依次应用搜索和标签条件。结果为空时显示独立文案：

```tsx
const visibleSkills = skills
  .filter((skill) => !skill.is_force_delivery)
  .filter(matchesSearch)
  .filter((skill) => tag === ALL_SKILLS_TAG || (skill.tags || []).includes(tag))

return visibleSkills.length > 0 ? (
  visibleSkills.map((skill) => (
    <SkillItem
      key={skill.id}
      skill={skill}
      selectedSkills={selectedSkills}
      onSkillChange={onSkillChange}
    />
  ))
) : (
  <div role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
    {t("taskWorkflow.skill.searchEmpty")}
  </div>
)
```

- [x] **步骤 5：增加中英文文案**

在 `taskWorkflow.skill` 中增加：

```ts
searchPlaceholder: "搜索 Skill 名称、描述或标签",
searchEmpty: "未找到匹配的 Skill",
```

```ts
searchPlaceholder: "Search Skill names, descriptions, or tags",
searchEmpty: "No matching Skills found",
```

### 任务 2：移除错误入口改动

**文件：**
- 修改：`frontend/src/pages/console/manager/skills.tsx`
- 修改：`frontend/src/i18n/resources/cn.ts`
- 修改：`frontend/src/i18n/resources/en.ts`

**接口：**
- 恢复 `TeamManagerSkills` 使用原始 `skills` 列表。
- 移除 `managerSkills.search` 文案，保留同文件内其他现有内容。

- [x] **步骤 1：移除团队管理页搜索 UI 和过滤逻辑**

移除本分支新增的 `Search`、`Input`、`searchQuery`、`normalizedSearchQuery`、`filteredSkills` 和搜索空结果分支，并恢复：

```tsx
{skills.map((skill) => (
  <Card key={skill.id}>
```

- [x] **步骤 2：移除团队管理搜索文案**

从中英文 `managerSkills` 对象移除本分支新增的 `search` 对象，其他键保持不变。

### 任务 3：静态验证和人工预览

**文件：**
- 验证：`frontend/src/components/console/task/task-skill-selector.tsx`
- 验证：`frontend/src/i18n/resources/cn.ts`
- 验证：`frontend/src/i18n/resources/en.ts`

- [x] **步骤 1：检查补丁格式**

执行：

```bash
git diff --check
```

预期：退出码为 0，无空白错误。

- [x] **步骤 2：运行 lint**

执行：

```bash
pnpm lint
```

预期：ESLint 退出码为 0。

- [x] **步骤 3：运行 online 构建**

执行：

```bash
pnpm run build:online
```

预期：TypeScript 和 Vite 构建成功，退出码为 0。

- [x] **步骤 4：人工预览三个入口**

复用 online 预览并验证：

- 任务输入、默认任务创建和项目开始开发均显示搜索框。
- 名称、描述和标签可以匹配，英文大小写结果一致。
- 搜索结果与当前标签取交集，清空关键词恢复原始顺序。
- 无匹配项显示空结果，关闭并重新打开后关键词为空。
- Skill 选择、取消选择、默认 Skill 和强制下发 Skill 行为保持不变。
- 桌面端和移动端布局可用。

- [x] **步骤 5：等待用户提交指令**

保持功能文件、设计文档和实施计划为未提交状态。用户测试通过并明确要求提交后，再按中文提交规范执行提交。
