# Desktop 批量技能导入需求

## 简介

为 MonkeyCode Desktop 增加批量技能导入能力。用户可以一次选择多个本地文件夹或多个 ZIP；每个来源可以包含一个或多个目录型技能。Desktop 在写入用户技能库前统一完成技能发现、内容预览、安全提示、批次内重名处理和已有技能冲突处理。

批次中的技能采用逐项事务安装：一个技能失败不回滚已经成功安装的其他技能，Desktop 在批次结束后汇总成功、失败和跳过结果。

## 术语

- **技能包**：包含一个 `SKILL.md` 和可选 `scripts/`、`references/`、`examples/`、`assets/` 的目录。
- **导入来源**：用户通过系统文件选择器选中的一个本地文件夹或 ZIP 文件。
- **导入批次**：用户在一次导入流程中加入的全部导入来源和检测到的技能项。
- **技能项**：导入批次中检测到的一个技能包。
- **批次内重名**：两个或多个技能项解析得到相同技能名称。
- **已有技能冲突**：技能项名称与用户技能库或内置技能名称相同。
- **用户技能库**：`<app_config_dir>/skills/` 下由 Desktop 管理的用户级技能目录。
- **可执行文件**：`scripts/` 下的文件，以及具有平台可执行标记或脚本扩展名的文件。
- **逐项事务安装**：每个技能项独立提交或回滚，已成功技能不受其他技能失败影响。
- **可移植名称键**：技能名称的 ASCII 小写形式，用于跨平台检测批次内重名和大小写冲突。

## 需求

### 需求 1：入口与来源选择

**用户故事：** 作为 Desktop 用户，我希望从使用技能的相关界面进入批量导入，以便快速添加已有技能。

1. Desktop SHALL 在“设置 → 技能”页面顶部同时提供“新建技能”和“导入技能”操作。
2. Desktop SHALL 在自定义技能空状态中提供“导入技能”操作。
3. Desktop SHALL 在新建任务和当前会话的技能选择器底部提供“导入或管理技能”入口。
4. WHILE 当前会话正在运行，Desktop SHALL 保持技能选择器的“导入或管理技能”入口可用，同时禁用该会话的技能选择修改。
5. WHEN 用户选择“导入技能”，Desktop SHALL 提供“选择文件夹”和“选择 ZIP”两个来源操作。
6. WHEN 用户选择“选择文件夹”，Desktop SHALL 使用操作系统文件选择器允许用户一次选择一个或多个文件夹。
7. WHEN 用户选择“选择 ZIP”，Desktop SHALL 使用操作系统文件选择器允许用户一次选择一个或多个 `.zip` 文件。
8. WHILE 导入预览处于打开状态，Desktop SHALL 允许用户继续向当前导入批次添加文件夹或 ZIP。
9. WHEN 用户取消系统文件选择，Desktop SHALL 保持当前导入批次和用户技能库不变。
10. WHEN 用户重复选择同一个导入来源，Desktop SHALL 在当前导入批次中保留该来源的一份记录。
11. Desktop SHALL 允许每个 Desktop 实例最多保留一个活动导入批次。
12. WHEN WebView 丢失活动批次状态后再次打开导入入口，Desktop SHALL 返回包含当前阶段、在途来源数和累计结果的现有批次快照，并仅开放该阶段允许的操作。
13. IF 导入批次的来源数量超过 100 个，Desktop SHALL 停止添加当前来源并显示来源数量上限。
14. WHILE 当前批次存在尚未完成的来源选择或暂存操作，Desktop SHALL 保持批次处于收集阶段、禁用批次提交并拒绝启动第二个并发来源操作。
15. WHEN 批次开始首次提交，Desktop SHALL 拒绝向该批次追加新的导入来源。

### 需求 2：多技能发现

**用户故事：** 作为社区技能使用者，我希望 Desktop 自动发现文件夹或 ZIP 中的多个技能，以便导入完整技能集合。

1. WHEN 导入来源根目录包含 `SKILL.md`，Desktop SHALL 将根目录识别为一个技能项。
2. WHEN 导入来源根目录不包含 `SKILL.md`，Desktop SHALL 递归扫描导入来源中的目录。
3. WHEN 扫描目录包含 `SKILL.md`，Desktop SHALL 将该目录识别为一个技能项并停止扫描该目录的后代目录。
4. Desktop SHALL 扫描 `.claude/skills`、`.agents/skills` 和 `.ohmyagent/skills` 中的技能目录。
5. Desktop SHALL 排除 `.git`、`__MACOSX`、`.imports`、`.backups`、`.transactions` 和平台元数据文件。
6. IF 导入来源未发现技能项，Desktop SHALL 将该来源标记为无可导入技能并显示支持的目录结构。
7. IF 单个导入来源无法读取，Desktop SHALL 将该来源标记为失败并继续处理当前批次的其他来源。
8. IF 单个技能项无法解析，Desktop SHALL 将该技能项标记为无效并继续处理当前批次的其他技能项。
9. WHEN `SKILL.md` 声明顶层 `name`，Desktop SHALL 使用顶层 `name` 作为技能名称。
10. WHEN `SKILL.md` 未声明顶层 `name`，Desktop SHALL 使用技能包目录名作为技能名称；ZIP 虚拟根目录技能使用 ZIP 文件名去除 `.zip` 后的 stem。
11. IF 顶层 `name` 与技能包目录名不同，Desktop SHALL 在预览中提示安装目录将使用顶层 `name`。
12. WHEN Agent 加载已导入技能，Agent SHALL 使用与 Desktop 导入预览相同的技能名称。
13. WHEN `SKILL.md` 通过 Desktop 大小校验，Agent SHALL 支持解析该文件中不超过 1 MiB 的单行内容。
14. Desktop SHALL 仅接受通过现有 `valid_skill_name` 单段安全名称规则的技能名称，并禁止名称影响用户技能库之外的路径。

### 需求 3：安全与容量校验

**用户故事：** 作为安全敏感用户，我希望 Desktop 隔离并校验每个导入来源，以便防止恶意压缩包或目录读取越界。

1. IF 用户选中的来源自身或来源内容包含符号链接、重解析点、绝对路径条目或父目录跳转条目，Desktop SHALL 拒绝受影响的导入来源。
2. Desktop SHALL 在可能阻塞的打开或读取前验证用户选中的文件夹或 ZIP 是普通目录或普通磁盘文件。
3. IF 文件夹条目在检查与读取之间变为符号链接或重解析点，Desktop SHALL 中止受影响的导入来源。
4. Desktop SHALL 保持受影响来源的暂存区不包含所选来源根目录之外的内容。
5. WHILE Desktop 复制文件夹来源，Desktop SHALL 按实际读取字节流式累计单文件、技能项和批次大小并在达到对应上限后停止读取。
6. IF 文件夹来源包含非普通文件或目录的条目，Desktop SHALL 在阻塞打开或读取前拒绝受影响的来源。
7. IF 文件夹或 ZIP 中两个不同条目解析到暂存文件系统中的同一对象，Desktop SHALL 拒绝受影响的来源且保持暂存区不包含任何该来源内容。
8. IF ZIP 文件或其中央目录元数据超过规定上限，Desktop SHALL 在解析归档条目内容前拒绝受影响的 ZIP。
9. IF 单个技能项的文件数超过 1,000，Desktop SHALL 将该技能项标记为无效。
10. IF 单个技能项的总大小超过 50 MiB，Desktop SHALL 将该技能项标记为无效。
11. IF 单个文件超过 10 MiB，Desktop SHALL 将所属技能项标记为无效。
12. IF `SKILL.md` 超过 1 MiB，Desktop SHALL 将所属技能项标记为无效。
13. IF 导入批次检测到的技能项超过 100 个，Desktop SHALL 停止添加当前来源并显示 100 个技能的批次上限。
14. IF 单个技能项的文件和目录条目总数超过 1,000，Desktop SHALL 将该技能项标记为无效。
15. IF 导入批次的文件和目录条目总数超过 10,000，Desktop SHALL 停止添加当前来源并显示 10,000 个条目的批次上限。
16. IF 任一路径深度超过 64 层，Desktop SHALL 拒绝受影响的导入来源。
17. IF 导入批次的暂存总大小超过 500 MiB，Desktop SHALL 停止添加当前来源并显示 500 MiB 的批次上限。
18. IF 同一配置目录中全部活动导入批次的暂存总大小超过 1 GiB 或文件和目录条目总数超过 20,000，Desktop SHALL 拒绝继续暂存新的来源。
19. IF ZIP 损坏、加密或使用不支持的压缩方式，Desktop SHALL 拒绝受影响的 ZIP 并继续处理其他来源。
20. WHILE 导入预览处于打开状态，Desktop SHALL 保持用户技能库不变。
21. WHEN Desktop 启动，Desktop SHALL 删除不属于活动进程或未完成安装事务的孤儿导入暂存目录。

### 需求 4：批量预览与选择

**用户故事：** 作为技能管理者，我希望在一次预览中检查并选择多个技能，以便控制实际安装内容。

1. WHEN 技能发现完成，Desktop SHALL 展示来源数量、技能项数量、可导入数量、冲突数量、风险数量和无效数量。
2. Desktop SHALL 为每个技能项展示名称、描述、来源、文件数量、总大小和状态。
3. WHEN 用户展开技能项，Desktop SHALL 展示该技能项的完整文件树。
4. WHEN 用户选择 UTF-8 文本文件，Desktop SHALL 展示该文件的只读内容预览。
5. WHEN 技能项包含可执行文件，Desktop SHALL 单独列出可执行文件并显示安全警告。
6. WHEN `SKILL.md` 声明工具、脚本、Hook、MCP 或网络相关能力，Desktop SHALL 突出显示对应声明。
7. Desktop SHALL 默认选择不存在冲突且通过校验的技能项。
8. Desktop SHALL 禁止选择无效技能项。
9. Desktop SHALL 允许用户逐项选择或取消选择可导入技能项。
10. Desktop SHALL 提供“全选可导入项”和“取消全选”操作。
11. WHILE 选中技能项包含可执行文件，Desktop SHALL 要求用户确认已经检查可执行内容后再允许提交批次。
12. WHEN 用户取消导入预览，Desktop SHALL 丢弃当前导入批次并保持用户技能库不变。

### 需求 5：重名与冲突处理

**用户故事：** 作为技能管理者，我希望逐项解决批次内重名和已有技能冲突，以便避免静默覆盖。

1. WHEN 两个或多个技能项具有相同可移植名称键，Desktop SHALL 将对应技能项标记为批次内重名。
2. WHILE 批次内重名尚未解决，Desktop SHALL 禁止同时选择同组技能项。
3. WHEN 用户选择一个批次内重名技能项，Desktop SHALL 将其他同组技能项设为跳过。
4. WHEN 技能项名称与用户技能名称完全相同，Desktop SHALL 将该技能项标记为用户技能冲突并把默认动作设为“跳过”。
5. WHEN 技能项与用户技能具有相同可移植名称键但名称大小写不同，Desktop SHALL 将该技能项标记为不可替换的名称大小写冲突。
6. WHEN 用户将用户技能冲突项的动作改为“替换”，Desktop SHALL 显示现有技能将被完整替换的提示。
7. WHEN 技能项名称与内置技能名称完全相同且不存在用户技能冲突，Desktop SHALL 将该技能项标记为覆盖内置。
8. WHEN 技能项与内置技能具有相同可移植名称键但名称大小写不同，Desktop SHALL 将该技能项标记为不可安装的名称大小写冲突。
9. WHEN 用户选择覆盖内置技能，Desktop SHALL 提示删除导入版本后可恢复内置版本。
10. Desktop SHALL 为用户技能冲突提供“替换”或“跳过”动作。
11. Desktop SHALL 为内置技能冲突提供“覆盖内置”或“跳过”动作。
12. Desktop SHALL 为批次内重名提供“选择当前候选”或“跳过”动作。
13. Desktop SHALL 禁止选择名称大小写冲突的技能项。
14. Desktop SHALL 保持没有冲突的技能项不受其他技能项冲突决策影响。

### 需求 6：批次提交与结果

**用户故事：** 作为批量导入用户，我希望有效技能可以独立安装并获得完整结果，以便修复失败项而不重复安装成功项。

1. WHEN 用户首次提交导入批次，Desktop SHALL 为批次中的每个技能项提交一个“安装”“替换”或“跳过”决策。
2. Desktop SHALL 拒绝包含重复技能项 ID 的首次提交或重试请求，并保持批次可再次提交或重试。
3. WHILE 来源选择/暂存、首次提交或失败项重试正在校验或执行，Desktop SHALL 拒绝取消、关闭、重复提交和来源追加请求。
4. WHEN 技能项决策为“跳过”，Desktop SHALL 将技能项状态设为已跳过且保持用户技能库不变。
5. Desktop SHALL 按预览中的稳定顺序逐项处理技能决策。
6. Desktop SHALL 为每个“安装”或“替换”技能项使用独立事务。
7. IF 单个技能项安装失败，Desktop SHALL 回滚该技能项并继续处理批次中的后续技能项。
8. Desktop SHALL 保持已成功安装的技能不受后续技能项失败影响。
9. WHILE Desktop 提交或恢复导入批次，Desktop SHALL 延迟技能列表读取和会话技能物化直至批次写入或恢复完成。
10. Desktop SHALL 使用跨进程技能库锁协调全部 Desktop 进程的技能库读取、写入和事务恢复，并使用跨进程会话锁协调同一会话的技能物化、引擎创建和技能选择修改。
11. IF Desktop 在替换技能期间异常退出，Desktop SHALL 在下一次技能库读取前恢复未完成的技能事务。
12. IF Desktop 无法自动恢复技能事务，Desktop SHALL 检测原版本、已安装版本和隔离版本的可用性。
13. WHILE 自动恢复失败且权威技能目录缺失，Desktop SHALL 使用可由 UI 和 Driver 区分的恢复待处理错误暂停技能列表读取和会话技能物化直至用户解决恢复问题。
14. Desktop SHALL 在每次恢复门控检查时与持久事务状态重新同步，并在普通读取或任何技能库写入发现其他进程留下的未完成事务时先执行自动恢复，以便接管崩溃事务或在其他进程解决问题后解除本进程阻塞。
15. WHEN 原版本可用，Desktop SHALL 提供“恢复原版本”操作。
16. WHEN 已安装版本可用，Desktop SHALL 提供“保留已安装版本”操作。
17. IF 原版本和已安装版本均不可用，Desktop SHALL 提供“保留恢复文件并解除阻塞”操作并显示保留目录。
18. WHEN 批次处理完成，Desktop SHALL 展示当前批次全部技能项的成功、失败和跳过数量。
19. WHEN 批次包含失败技能项，Desktop SHALL 展示每个失败项的失败原因。
20. WHEN 用户重试失败项，Desktop SHALL 仅接受状态为失败的技能项决策，并依据当前技能库重新计算冲突及重新验证动作；IF 冲突已变化，Desktop SHALL 要求用户重新选择和确认合法动作。
21. WHEN 失败技能项重试成功，Desktop SHALL 将技能项状态从失败更新为成功。
22. Desktop SHALL 保持成功和已跳过技能项为终态。
23. WHEN 批次至少包含一个成功技能项，Desktop SHALL 在允许用户关闭结果视图前发布技能库变更并刷新所有已挂载的技能列表和选择器；IF 刷新被恢复待处理错误阻塞，结果视图 SHALL 直接提供对应恢复操作并在解决后重试刷新。
24. Desktop SHALL 防止较早发起、较晚返回的技能列表请求覆盖更新的技能库视图，并在其他 Desktop 进程修改技能库后刷新当前实例。
25. WHEN 批次至少包含一个成功技能项，Desktop SHALL 展开本批次成功安装的技能分组。
26. WHEN 技能项安装成功，Desktop SHALL 按现有用户技能出厂规则将技能设为默认启用。
27. BEFORE Desktop 允许任何技能库修改，Desktop SHALL 为缺少显式技能列表的已有会话持久化当时的默认技能快照。
28. Desktop SHALL 保持已有会话的显式技能选择快照不变。

### 需求 7：导入后管理

**用户故事：** 作为 Desktop 用户，我希望批量导入的技能沿用现有管理方式，以便统一管理所有自定义技能。

1. Desktop SHALL 将成功导入的技能标记为用户技能。
2. Desktop SHALL 为成功导入的技能提供现有默认启用、编辑和删除操作。
3. WHEN 用户编辑导入技能，Desktop SHALL 仅修改 `SKILL.md` 并保留技能目录中的其他文件。
4. WHEN 用户删除导入技能，Desktop SHALL 删除技能目录中的 `SKILL.md` 和全部辅助文件。
5. WHEN 新会话使用默认技能集，Desktop SHALL 按现有默认启用规则包含已启用的导入技能。

### 需求 8：可访问性、国际化与验证

**用户故事：** 作为不同平台和语言环境的用户，我希望批量导入流程可理解且可操作，以便稳定完成技能安装。

1. Desktop SHALL 为来源、批次摘要、技能状态、风险、冲突、进度和结果提供中英文文案。
2. Desktop SHALL 为批量列表、技能展开项、冲突动作和提交控件提供可访问名称。
3. Desktop SHALL 支持通过键盘完成技能选择、展开预览、冲突处理和批次提交。
4. WHILE 批次尚未开始提交，WHEN 用户按下 `Escape`，Desktop SHALL 关闭当前最高层导入浮层且不安装技能。
5. WHILE 批次正在提交，Desktop SHALL 禁用关闭和取消操作直至当前批次处理完成。
6. WHILE Desktop 执行技能列表读取、技能库写入、来源暂存、批次取消、批次提交或事务恢复，Desktop SHALL 保持窗口重绘和其他 IPC 可响应。
7. Desktop SHALL 使用自动化测试覆盖多文件夹、多 ZIP、单 ZIP 多技能、可移植名称冲突、部分成功、失败项重试、条件恢复操作和安全限制。

## 本次范围外

- 从 GitHub、Git URL 或远程 URL 导入技能。
- 技能市场、推荐榜单、评价、下载量和自动更新。
- 项目级、会话级、团队级或组织级安装。
- 导出技能包。
- 在 Desktop 中编辑 `scripts/`、`references/`、`examples/` 或 `assets/`。
- 对脚本内容进行恶意代码判定或病毒扫描。
- 批次级全有或全无事务。
- 改变 Agent 的工具审批、沙箱、网络或权限模型。
