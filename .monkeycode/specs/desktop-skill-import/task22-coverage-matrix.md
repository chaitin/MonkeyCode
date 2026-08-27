# Task 22 前端自动化覆盖矩阵

> 2026-08-27 在开始补测前逐项审计。`已有` 只表示对应测试直接断言了该行为，不把相邻测试或同类样例泛化为覆盖；`本次补齐` 是本次针对缺口增加的 RTL/IPC mock 行为测试。

## 22.1 IPC / Provider

| 原子行为 | 开始时的精确已有覆盖 | 开始时缺口 | 完成后的直接覆盖 |
|---|---|---|---|
| 导入/恢复 IPC 命令名、camelCase 参数、结构化错误 | `lib/ipc/skills.test.ts:20,66` | 无 | 原测试保留 |
| listen-before-current | `useSkillImportController.test.tsx:23`；catalog 监听屏障 `SkillsCatalogProvider.test.tsx:40` | 无 | 原测试保留 |
| reload 重附着 collecting/validating/submitting/completed/retry-validating/retrying 每个 phase | 只有操作映射的少量样例，未逐 phase 经 `current` 重载 | 缺六阶段真实重附着 | `useSkillImportController.test.tsx:61` 参数化逐阶段断言快照和允许操作 |
| 逆序 snapshot/current | `useSkillImportController.test.tsx:23` | 无 | 原测试保留 |
| cancel 删除墓碑与迟到 current | 只有手工事件墓碑，未走 cancel IPC | 缺 cancel→墓碑→旧 current 链路 | `useSkillImportController.test.tsx:94` |
| catalog server revision / request generation 竞态 | `SkillsCatalogProvider.test.tsx:88,181,214` | 无 | 原测试保留 |
| 跨 Desktop 实例事件（store 变化且 revision 重新从低值开始） | 只有普通 catalog event 触发 list，未验证跨 store 降 revision | 缺跨实例权威切换 | `SkillsCatalogProvider.test.tsx:132` |
| focus 丢事件校准 | `SkillsCatalogProvider.test.tsx:72,106` 只直接断言调用 | 缺已挂载消费者的可见更新 | `SkillsCatalogProvider.test.tsx:132` 断言菜单外消费者更新 |
| menu 丢事件校准 | `pickers.test.tsx:81` 只断言 `onOpen`；Provider 测试只直接调方法 | 缺真实 `SkillsMenu` + Provider 链路 | `SkillsCatalogProvider.test.tsx:132` 打开真实菜单并断言选项由 focus 版本刷新到 menu 版本 |

## 22.2 入口、导航、运行态与会话 revision

| 原子行为 | 精确覆盖 |
|---|---|
| 设置页顶部“新建/导入”和自定义空态“新建/导入”，文件夹/ZIP 入口 | `SkillsSection.test.tsx:60`（两处按钮及两种 pick 参数） |
| App 当前会话入口精确打开设置→技能，普通设置打开不残留目标页 | `app/App.test.tsx:121` |
| NewTaskModal 管理入口精确导航 skills | `features/newtask/NewTaskModal.test.tsx:269` |
| Composer / SkillsMenu 管理入口精确导航 skills | `app/App.test.tsx:121` 的真实 Composer 链路；组件边界 `composer/pickers.test.tsx:44` |
| 运行中菜单 trigger/管理入口仍可用、checkbox 禁用且不触发修改 | `composer/Composer.test.tsx:418`；`composer/pickers.test.tsx:44` |
| 新会话显式 skills（含显式空数组）不回退默认 | `NewTaskModal.test.tsx:283,297` |
| 历史会话旧 poll / 旧 skills_revision 不回退 | `sessionSkillsState.test.tsx:19`；真实 Composer `Composer.test.tsx:788` |
| 同会话逆序 mutation、切会话迟到 mutation 不污染 | `Composer.test.tsx:824,859` |
| catalog 提升等待已挂载 Composer 消费 revision | `sessionSkillsState.test.tsx:39` |
| 已挂载技能列表和 SkillsMenu 同步刷新 | 开始时缺真实菜单与 Provider 集成；本次由 `SkillsCatalogProvider.test.tsx:132` 直接断言两处可见内容 |

## 22.3 批量工作台 / 行预览

| 原子行为 | 开始时的精确已有覆盖 | 本次补齐 |
|---|---|---|
| 一次多文件夹、一次多 ZIP、继续追加且复用 batch id | 只有单次 folder/ZIP 和一次静态 controller `pick("zips")` | `SkillsSection.test.tsx:101` 真实 hook + IPC mock：2 folders 后追加 2 ZIP，断言摘要、来源行、两次 IPC 参数 |
| 来源在途：状态、禁提交、禁追加、禁关闭 | 只有纯操作映射 | `SkillsSection.test.tsx:142` current 重附着真实 RTL |
| 摘要与 all/risk 等筛选 | `BatchSkillImportDialog.test.tsx:136` | 原测试保留 |
| 取消全选/全选只作用于无冲突有效项 | 开始时只点过“取消全选”，未断言“全选”边界 | `BatchSkillImportDialog.test.tsx:187` |
| 批次重名单选互斥 | `BatchSkillImportDialog.test.tsx:136` | `:187` 另断言 clear/select-all 不越过重名约束 |
| user/builtin 冲突动作与稳定全量 decision | `BatchSkillImportDialog.test.tsx:136` | 原测试保留 |
| 目录名与 frontmatter name 不同的安装目录提示 | `SkillImportItemRow.test.tsx:79` | 原测试保留 |
| 完整文件树、UTF-8 IPC 预览、分页 offset/eof | `SkillImportItemRow.test.tsx:59,79` | 原测试保留 |
| 文件切换/翻页逆序响应隔离 | `SkillImportItemRow.test.tsx:122,153,171` | 原测试保留 |
| 风险/能力、可执行路径与确认后才能提交 | `SkillImportItemRow.test.tsx:79`；`BatchSkillImportDialog.test.tsx:136` | 原测试保留 |
| 校验/提交/重试阶段锁定 | `BatchSkillImportDialog.test.tsx:239` | 新增 `SkillsSection.test.tsx:164` 覆盖点击提交后 IPC 未返回窗口：Escape、重复提交、追加均被锁 |
| 无效项和大小写冲突禁选 | `SkillImportItemRow.test.tsx:214`；`BatchSkillImportDialog.test.tsx:136` | 原测试保留 |

## 22.4 结果与恢复

| 原子行为 | 精确覆盖 |
|---|---|
| 部分成功/失败/跳过累计结果、失败原因 | `BatchSkillImportDialog.test.tsx:313` |
| failed-only 重试 decision | `BatchSkillImportDialog.test.tsx:313` |
| catalog target revision 可见前禁关闭 | `BatchSkillImportDialog.test.tsx:313` |
| 成功后展开用户组并高亮成功项 | `SkillsSection.test.tsx:231` |
| 设置页异常事务横幅 | `SkillsSection.test.tsx:199` |
| 结果内联 RecoveryPending、解决后重试刷新才解锁 | `BatchSkillImportDialog.test.tsx:253` |
| 条件恢复动作只取后端 actions | `RecoveryPanel.test.tsx:28`（preserve-only）；本次 `:75` 增加 restore-only/keep-only 两 issue |
| preserved path 外显并等待 catalog revision | `RecoveryPanel.test.tsx:28`，并精确断言 resolve IPC 参数 |
| 多 issue 最后解除权威缺失后等待累计最高 revision | 本次 `RecoveryPanel.test.tsx:75` |
| `conn-status.code=skill-recovery-pending` 精确入口，其他物化错误不误显示入口 | `ChatView.test.tsx:953` |

## 22.5 Escape / 键盘 / 焦点 / a11y / i18n

| 原子行为 | 精确覆盖 |
|---|---|
| Escape 只先关最高层来源菜单，再取消批次且不 commit | `BatchSkillImportDialog.test.tsx:77` |
| active phase / IPC commit 在途禁 Escape、关闭、取消 | `BatchSkillImportDialog.test.tsx:239`；`SkillsSection.test.tsx:164` |
| 键盘 tab roving、选择、展开、焦点环、提交 | `BatchSkillImportDialog.test.tsx:96` |
| 冲突动作方向键选择、展开替换提示、键盘提交 | 开始时只有 `selectOptions`；本次 `BatchSkillImportDialog.test.tsx:211`，并在 `SkillImportItemRow.tsx` 为受控原生 select 钉住方向/Home/End 行为 |
| 行 checkbox/展开 region/tree/treeitem 的 accessible name/关系 | `SkillImportItemRow.test.tsx:59` |
| dialog/tab/tabpanel/list/source menu/submit/review/close 的 accessible name/关系 | `BatchSkillImportDialog.test.tsx:77,96,136` |
| Recovery region/action/status 的 accessible name 与焦点顺序 | `RecoveryPanel.test.tsx:28` |
| 中英文键集合一致、非空 | `lib/i18n/i18n.test.ts:27` |
| 技能导入 key 不允许“每类抽一个”泛化 | 开始时每类只列一个样例；本次 `lib/i18n/i18n.test.ts:35` 显式对表全部 import/recovery key 集合 |

所有测试均通过 RTL 查询用户可见 role/name/state 或 IPC mock 的命令、参数、时序及返回后 UI 状态；没有读取组件源码并匹配 source string 的测试。
