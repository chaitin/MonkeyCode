# Desktop 批量技能导入实施计划

- [x] 1. 建立 Rust 公共契约、限制常量与技能名称规范（需求 2.9–2.14、3.9–3.18、4.1–4.11、5.1–5.14、6.1–6.26；设计“Skill Discovery / 名称规则”“Secure Staging / 限制层级”“Components and Interfaces / Rust 数据模型”）
  - [x] 1.1 在 `desktop/src/skill_import/model.rs` 与 `desktop/src/skills.rs` 定义批次、来源、文件树、风险、有效性、冲突、决策、结果、恢复、catalog/session mutation、snapshot envelope/phase 和结构化错误等可序列化契约，并集中定义全部来源/技能/文件/ZIP/批次/跨实例限制常量（需求 1.12–1.15、2.6–2.14、3.8–3.19、4.1–4.11、5.1–5.14、6.1–6.24；设计“Rust 数据模型”“暂存状态”“限制层级”“Tauri 命令”）
  - [x] 1.2 扩展 `valid_skill_name` 及导入名称解析，严格读取顶层 frontmatter，支持目录名与 ZIP 虚拟根 stem 回退，生成 ASCII 小写可移植名称键，并拒绝路径组件、Windows 保留名和尾随点号（需求 2.9–2.14、5.1–5.13；设计“Skill Discovery / 名称规则”“Correctness Properties”第 4、5、12 项）
  - [x] 1.3 实现风险与能力声明分析、描述提取、可执行文件判定、稳定来源/技能排序和仅返回末级来源显示名的预览转换（需求 4.1–4.8、4.11、6.5；设计“批量预览工作台”“Rust 数据模型”“批次提交校验”）

- [x] 2. 实现安全文件夹枚举、发现与逐技能暂存（需求 2.1–2.8、3.1–3.7、3.9–3.17、3.20；设计“Skill Discovery / 发现算法”“Secure Staging / 文件夹来源”）
  - [x] 2.1 在 `desktop/src/skill_import/folder.rs` 建立基于固定根句柄、父目录相对打开和不跟随链接的跨平台枚举器；只接受复核为同一对象的普通文件/目录，并在阻塞打开前拒绝 symlink、reparse point、FIFO、socket、设备及检查后替换（需求 3.1–3.6、8.6；设计“文件夹来源”第 1–7、10–13 项）
  - [x] 2.2 从安全来源清单执行 DFS 发现，落实根技能、命中 `SKILL.md` 后停止后代扫描、兼容目录扫描、内部目录/平台元数据排除、规范相对路径与稳定顺序（需求 2.1–2.8；设计“发现算法”）
  - [x] 2.3 仅复制已发现技能根后代，在实际读取流上累计文件/目录 entry、单文件、`SKILL.md`、技能和批次字节，逐技能隔离部分暂存；用独占创建和实际名称/对象复核拒绝大小写、别名及文件目录碰撞（需求 3.3–3.7、3.9–3.17、3.20；设计“文件夹来源”第 7–10 项、“Error Handling”）

- [x] 3. 实现安全 ZIP 索引、发现与逐技能解压（需求 1.7、2.1–2.8、3.1–3.4、3.7–3.19；设计“Secure Staging / ZIP 来源”“Skill Discovery / 发现算法”）
  - [x] 3.1 在 `desktop/src/skill_import/archive.rs` 从父目录安全打开普通磁盘文件，以有界 `Read + Seek` 解析 EOCD/Zip64 和中央目录，在读取条目内容前执行归档大小、元数据大小、条目数、偏移边界、损坏/加密/压缩方式校验（需求 3.1–3.4、3.8、3.15、3.19；设计“ZIP 来源”第 1–2 段、“限制层级”）
  - [x] 3.2 规范化完整 ZIP 索引并拒绝绝对路径、Windows 前缀、父跳转、symlink、过深路径、逻辑路径重复、大小写/别名碰撞和文件目录类型冲突，再按与文件夹相同规则发现技能根（需求 2.1–2.8、3.1、3.7、3.14–3.16；设计“ZIP 来源”索引校验清单、“Correctness Properties”第 14 项）
  - [x] 3.3 只将技能根后代解压到独立暂存目录，以实际写入流逐项执行文件/技能/批次限制，技能级超限仅隔离当前技能，ZIP 结构或对象碰撞则清理并拒绝整个来源（需求 3.7、3.9–3.19；设计“ZIP 来源”第 3–4 段、“Error Handling”）

- [x] 4. 实现跨实例暂存配额、instance lease 与孤儿回收（需求 1.10–1.11、1.13、2.6–2.8、3.13、3.15、3.17–3.18、3.21；设计“限制层级”“暂存状态”生命周期第 1–3、9–10 项）
  - [x] 4.1 在 `desktop/src/skill_import/lease.rs` 通过 `<app_config_dir>/skill-import-staging.lock` 原子预留/释放配置目录级字节与 entry 配额，在创建 entry 前和流式写入时增量记账，任何拒绝路径完整回滚新来源预留（需求 3.15、3.17–3.18；设计“限制层级”“Correctness Properties”第 11 项）
  - [x] 4.2 为每个进程创建唯一实例目录并持有 lease 文件锁；启动时仅清理由非活动实例持有且不属于未完成安装事务的目录，不使用时间宽限（需求 3.21；设计“暂存状态”生命周期第 10 项、“Error Handling”）
  - [x] 4.3 实现来源指纹/规范来源键去重、失败和空来源计数、100 来源/100 技能以及批次总 entry/字节的原子合并守卫，超限时保持既有批次不变（需求 1.10、1.13、2.6–2.8、3.13、3.15、3.17；设计“暂存状态”生命周期第 3 项、“限制层级”）

- [x] 5. 实现单实例批次状态机、snapshot revision 与删除墓碑（需求 1.8–1.15、4.12、6.1–6.5、6.18–6.22；设计“暂存状态”“Tauri 命令”“批次提交校验”）
  - [x] 5.1 在 `desktop/src/skill_import/state.rs` 实现每实例唯一批次槽、唯一在途来源选择、Collecting/Validating/Submitting/Completed/RetryValidating/Retrying 转换、短临界区 revision clock 和阶段允许操作表（需求 1.8–1.15、6.1–6.3；设计“暂存状态”生命周期第 1–8 项）
  - [x] 5.2 实现 `skills_import_current` 一致 snapshot envelope、累计项目终态/结果、revision 单调事件以及 cancel 时更高 revision 的 `{ deleted: true }` 墓碑，确保旧查询不能复活已删除批次（需求 1.12、4.12、6.18–6.22；设计“Tauri 命令”snapshot/重附着协议、“Correctness Properties”第 9、10、15 项）
  - [x] 5.3 用 phase guard 覆盖验证错误、后台 task join 失败和执行中异常：首次预检失败回 Collecting，重试预检失败回 Completed，进入写入后未决项落 failed，所有成功/跳过项保持终态（需求 6.2–6.8、6.18–6.22；设计“批次提交校验”）

- [x] 6. 实现技能库多进程锁、catalog revision 与统一异步读写门控（需求 6.9–6.14、6.23–6.24、6.27–6.28、8.6；设计“Transaction and Concurrency / 共享技能库锁”“SkillsCatalogProvider”）
  - [x] 6.1 在 `desktop/src/skills.rs` 建立 `SkillStoreState`，固定“进程内 `RwLock` → `<app_config_dir>/skills.lock` OS advisory lock”的共享读/独占写顺序，并让 list、save、delete、default、import、recovery、materialize 共用同一状态（需求 6.9–6.14；设计“共享技能库锁”）
  - [x] 6.2 将现有技能 IPC 改为 async + `spawn_blocking`，在锁内重新校准持久事务、返回 `SkillCommandError`、`SkillsCatalogSnapshot` 或带目标 revision 的 mutation result，避免同步文件锁/扫描阻塞 Tauri 事件循环（需求 6.9–6.14、6.23–6.24、8.6；设计“Tauri 命令”后台操作与错误契约、“共享技能库锁”）
  - [x] 6.3 在每个权威目录变更事务内原子递增并同步 `skills.revision`，恢复变更同样推进 revision，并提供跨实例变化监视所需接口（需求 6.23–6.24；设计“SkillsCatalogProvider”第 2–3 段）

- [x] 7. 冻结历史会话 baseline 并引入 session skills revision（需求 6.27–6.28、7.5；设计“Frontend Components / 历史会话快照迁移”）
  - [x] 7.1 在首次 save/delete/default/import 之前、同一技能库写锁内扫描持久会话，把缺少显式 `meta.skills` 的会话按修改前默认集写入并同步 `legacy-session-skills-v1.json`；迁移失败保持技能库零写入（需求 6.27–6.28；设计“历史会话快照迁移”第 1 段）
  - [x] 7.2 修改 `desktop/src/driver/session.rs` 的会话列表、打开和物化取值顺序为 sidecar 显式值优先、legacy baseline 次之，并保证新会话继续写入显式快照（需求 6.27–6.28、7.5；设计“历史会话快照迁移”第 2 段）
  - [x] 7.3 为 `SessionMeta` 增加单调 `skills_revision`，让 baseline 显式化和成功 `session_set_skills` 推进 revision，并返回规范化 skills 与新 revision（需求 6.27–6.28；设计“Rust 数据模型”中的 `SessionSkillsMutationResult`、“历史会话快照迁移”第 2–3 段）

- [x] 8. 实现逐技能安装事务、崩溃恢复与条件解决（需求 6.4–6.17、6.20–6.22；设计“Transaction and Concurrency / 逐项事务”“崩溃恢复”）
  - [x] 8.1 在 `desktop/src/skill_transactions.rs` 实现 `.imports/.backups/.transactions` 事务布局、原子且同步的阶段日志、prepared/backup-created/installed 重命名序列、父目录同步和逐项回滚，单项失败后继续稳定顺序中的后续项（需求 6.4–6.8；设计“逐项事务”）
  - [x] 8.2 实现每次技能库读写前从磁盘重新校准并接管可恢复事务的读锁稳定循环；不可自动恢复 issue 结构化阻塞 list/write/materialize，且其他进程解决后本进程可解除旧缓存阻塞（需求 6.9–6.14；设计“崩溃恢复”第 1–5 段）
  - [x] 8.3 实现 `skills_recovery_list/resolve` 的候选复核和条件动作：恢复原版本、保留已安装版本、无权威候选时保留到 `skill-recovery/<transaction-id>` 并解除阻塞，同时返回保留路径和 catalog revision（需求 6.12–6.17；设计“崩溃恢复”恢复 issue 与设置页操作段落）

- [x] 9. 实现会话跨进程锁、原子物化与恢复错误传播（需求 6.9–6.17、6.27–6.28；设计“共享技能库锁”会话锁序、“崩溃恢复”物化与连接状态段落）
  - [x] 9.1 在 `desktop/src/driver/ohmy.rs`、`desktop/src/driver/session.rs` 注入共享 `SkillStoreState`，按 `skills_gate → session-skill-locks/<session-id>.lock → SkillStoreState` 固定顺序覆盖 open/resume/set-skills/materialize/create，delete 取得 session lock 后清理 sidecar/派生目录（需求 6.9–6.10、6.27–6.28；设计“共享技能库锁”最后三段）
  - [x] 9.2 将 `skills::materialize` 改为同级临时目录完整生成、旧目录备份、新目录原子切换和失败恢复；任何物化错误都保留旧目录并阻止 `session/create`（需求 6.9–6.14；设计“崩溃恢复”原子物化段落、“Correctness Properties”第 7 项）
  - [x] 9.3 保留 `RecoveryPending` 错误类别穿过 Driver、`spawn_resume` 和 `ConnStatusPayload.code`，映射为 `skill-recovery-pending`，其他物化错误映射为 `skill-materialize-failed`，禁止当前代码的静默降级恢复（需求 6.11–6.17；设计“崩溃恢复”连接状态段落、“Error Handling”）

- [x] 10. 实现来源选择、预览读取、提交与失败重试命令编排（需求 1.5–1.15、4.1–4.12、5.1–5.14、6.1–6.26；设计“Components and Interfaces / Tauri 命令”“批次提交校验”）
  - [x] 10.1 在 `desktop/src/skill_import/commands.rs` 实现系统多文件夹/多 ZIP 选择、取消不变、在途占位、重复来源去重、后台发现/暂存以及阶段复核后原子合并，绝不向 WebView 暴露绝对路径或通用文件系统权限（需求 1.5–1.15、2.1–2.8、3.20；设计“Tauri 命令”pick 协议、“Architecture”）
  - [x] 10.2 实现 `skills_import_read_text`，只以 batch/item/已验证相对路径在技能根句柄内读取 UTF-8 分页，限制单次 1 MiB，并保持读取错误局限于文件面板（需求 4.3–4.6；设计“Tauri 命令”文本预览段落、“Error Handling”）
  - [x] 10.3 实现首次 commit 全覆盖且 item ID 唯一的零写入预检、风险确认、无效/重名/用户与内置冲突动作校验、指纹复核，并在一次技能库写锁内按稳定顺序逐项事务提交（需求 4.7–4.11、5.1–5.14、6.1–6.10、6.26；设计“批次提交校验”首次提交规则）
  - [x] 10.4 实现仅接受 failed 项且 item ID 唯一的重试，在当前 catalog 下重算冲突并把变化写回 snapshot；返回全批次累计结果和最终 catalog revision，关闭时清理暂存/配额（需求 6.18–6.26；设计“批次提交校验”重试规则与累计结果段落、“结果视图”）

- [x] 11. 完成 Tauri 状态装配、命令注册、权限与 catalog 事件（需求 1.5–1.7、3.20–3.21、6.23–6.24、8.6；设计“Registration and Permissions”）
  - [x] 11.1 在 `desktop/src/main.rs` 初始化并共享 `SkillImportState`/`SkillStoreState`、执行 lease 孤儿清理/事务恢复、注册七个新命令，并监视 `skills.revision` 发出 `skills-catalog-changed`（需求 3.21、6.9–6.14、6.23–6.24；设计“Registration and Permissions”第 1 项、“SkillsCatalogProvider”）
  - [x] 11.2 更新 `desktop/build.rs` 和 `desktop/tauri.conf.json` 的七项 ACL 命令/`main-app.permissions`，仅复用 dialog 插件且不授予 WebView 通用文件系统读取权限（需求 1.5–1.7、3.20；设计“Registration and Permissions”第 2–4 项）
  - [x] 11.3 更新 `desktop/Cargo.toml`/`Cargo.lock` 以引入经过约束的 ZIP、跨进程锁和平台安全句柄能力，并保持 macOS/Windows/Linux 条件编译路径均可构建（需求 3.1–3.19、8.6；设计“Secure Staging”“共享技能库锁”）

- [x] 12. 修正 Agent 的技能 frontmatter 与大单行解析（需求 2.12–2.13；设计“Skill Discovery / 名称规则”）
  - [x] 12.1 修改 `agent/internal/skills/skill.go` 的 `parseFrontmatter`，忽略缩进行以只采纳顶层 name/description，确保 catalog 名称与 Desktop 预览及安装目录一致（需求 2.9、2.12；设计“名称规则”第 2 段、“Correctness Properties”第 12 项）
  - [x] 12.2 为 `parseSkillMetadata`、`parseFrontmatter` 及调用链所有先行 `SKILL.md` Scanner 配置 `MAX_SKILL_MD_BYTES + 1` buffer，使不超过 1 MiB 的单行可解析且超限仍被拒绝（需求 2.13；设计“名称规则”第 2 段）

- [x] 13. 编写并通过 Rust 发现、安全暂存、配额和批次自动化测试（需求 8.7；设计“Test Strategy / Rust：发现与安全”“Rust：批次与事务”）
  - [x] 13.1 在 `desktop/src/skill_import/*` 单元/集成测试中覆盖多文件夹、多 ZIP、ZIP 虚拟根 stem、单来源多技能、兼容/排除目录、命中根后停止、重复来源和稳定排序（需求 1.6–1.10、2.1–2.13、8.7；设计“Rust：发现与安全”前四项）
  - [x] 13.2 覆盖 ZIP Slip/绝对路径/Windows 前缀/symlink、损坏/加密/不支持压缩、中央目录/压缩炸弹、文件夹 TOCTOU、特殊文件、对象碰撞、深度与所有文件/技能/批次边界（需求 3.1–3.19、8.7；设计“Rust：发现与安全”安全与容量项）
  - [x] 13.3 覆盖单实例批次槽、并发 pick/commit/cancel Busy、snapshot 逆序与墓碑、首次/重试 phase guard、重复 item ID、冲突变化、累计终态和风险确认零写入（需求 1.11–1.15、5.1–5.14、6.1–6.5、6.18–6.22、8.7；设计“Rust：批次与事务”批次状态项）
  - [x] 13.4 用多进程测试 helper 覆盖配置目录总配额、instance lease、活动实例保留和崩溃实例立即回收（需求 3.18、3.21、8.7；设计“Rust：发现与安全”最后两项）

- [x] 14. 编写并通过 Rust 技能库事务、恢复、catalog、baseline 与会话并发自动化测试（需求 6.4–6.17、6.23–6.28、8.7；设计“Test Strategy / Rust：批次与事务”）
  - [x] 14.1 对每个事务文件系统步骤和重命名间注入错误/重启，覆盖部分成功、后续继续、自动恢复、条件候选操作、preserved path、issue 单次尝试及跨进程缓存重新校准（需求 6.4–6.17、8.7；设计“Rust：批次与事务”事务/恢复项）
  - [x] 14.2 用双进程 helper 交错 list/save/delete/default/import/recovery/materialize，断言两层技能库锁顺序、读取接管崩溃事务、catalog revision 单调和跨实例修改事件（需求 6.9–6.14、6.23–6.24、8.7；设计“Rust：批次与事务”多进程锁与 revision 项）
  - [x] 14.3 交错同一 session 的 open/set-skills/materialize/create/delete，覆盖 session 文件锁、旧目录原子保留、物化错误阻止 create、结构化 conn-status code 和 skills revision 逆序（需求 6.9–6.17、6.27–6.28、8.7；设计“Rust：批次与事务”会话锁/物化项）
  - [x] 14.4 覆盖 baseline 首次写入、幂等、并发 sidecar 写入/删除、迁移失败零技能库写入以及已有显式快照不变（需求 6.27–6.28、8.7；设计“Rust：批次与事务”历史会话项）

- [ ] 15. 编写并通过 Desktop/Agent 名称解析共享样例自动化测试（按用户要求不修改 Agent，当前仅保留 Desktop fixture；需求 2.9–2.14、8.7；设计“Test Strategy”Rust/Agent Scanner 对表项）
  - [ ] 15.1 在 Desktop 与 `agent/internal/skills` 使用同一组嵌套 frontmatter、无 name 回退、非法名和接近/超过 1 MiB 单行 fixture，分别断言预览名、安装目录和 Agent catalog 名一致（按用户要求不修改 Agent；需求 2.9–2.14、8.7；设计“名称规则”“Correctness Properties”第 12 项）
  - [x] 15.2 运行 `cargo test --manifest-path desktop/Cargo.toml` 的技能导入/技能库/会话相关测试及 `go test ./internal/skills/...`，修复全部失败（需求 8.7；设计“Test Strategy / 聚焦验证”Rust、Agent）

- [x] 16. 检查点：后端契约、安全、事务与多进程测试全部通过后再接入 UI（需求 8.6–8.7；设计“Test Strategy / 聚焦验证”Rust、Agent）

- [x] 17. 实现前端 IPC 契约、导入重附着控制器与 `SkillsCatalogProvider`（需求 1.12、6.18–6.24、6.27–6.28；设计“Frontend Components / SkillsCatalogProvider”“IPC 与国际化”）
  - [x] 17.1 扩展 `desktop/ui-next/src/lib/ipc/skills.ts`、`sessions.ts`、`controls.ts` 的批次/恢复七个 IPC、结构化错误、catalog/mutation revision、session skills revision 与 conn-status code 类型（需求 1.12、6.11–6.24、6.27–6.28；设计“IPC 与国际化”）
  - [x] 17.2 新增导入状态 hook/controller，严格先监听 `skills-import-updated` 再调用 current，仅接受更高 snapshot revision，处理墓碑/`batch=None`、卸载取消监听和各 phase 可用操作（需求 1.11–1.15、6.18–6.22；设计“Tauri 命令”snapshot/重附着协议）
  - [x] 17.3 在 App/Settings 共同父级新增 `SkillsCatalogProvider`，以服务端 revision 优先、generation 仅管理 loading；监听 catalog 事件，并在窗口 focus、技能分区/菜单打开时校准，写操作等待目标 revision（需求 6.23–6.24；设计“SkillsCatalogProvider”）
  - [x] 17.4 让 Provider 接受新 catalog 前等待会话状态层消费有效 `skills_revision`，Composer 以 server revision 确认乐观 `session_set_skills` 并拒绝旧轮询/旧响应回退（需求 6.27–6.28；设计“历史会话快照迁移”第 3 段）

- [x] 18. 实现设置分区导航和全部导入入口（需求 1.1–1.4；设计“User Experience / 入口”“设置分区导航”“SkillsMenu”）
  - [x] 18.1 新增 `SettingsNavigationContext`，把 `App.tsx` 的 `openSettings` 扩展为可指定 `SettingsSection`，并让 `SettingsView` 每次新打开时采用 `initialSection`（需求 1.3–1.4；设计“设置分区导航”）
  - [x] 18.2 改造 `SkillsSection.tsx` 顶部与自定义技能空状态，同时提供“新建技能”和“导入技能”以及文件夹/ZIP 来源菜单（需求 1.1–1.2、1.5；设计“设置页主入口”“SkillsSection.tsx”）
  - [x] 18.3 在新建任务和当前会话 `SkillsMenu` 底部加入精确跳转技能分区的“管理和导入技能”，拆分 triggerDisabled/selectionDisabled，保证运行中入口可用但勾选不可改（需求 1.3–1.4；设计“SkillsMenu”）

- [x] 19. 实现批量导入对话框、项目行与结果/重试流程（需求 1.5–1.15、4.1–4.12、5.1–5.14、6.1–6.8、6.18–6.26；设计“批量预览工作台”“BatchSkillImportDialog.tsx”“SkillImportItemRow.tsx”）
  - [x] 19.1 新增 `BatchSkillImportDialog.tsx`，实现继续添加文件夹/ZIP、来源在途进度、摘要/筛选、全选/取消全选、默认选择、无效禁选、批次重名单选和按 phase 禁用关闭/追加/提交（需求 1.5–1.15、4.1–4.3、4.7–4.12、5.1–5.3；设计“批量预览工作台”“BatchSkillImportDialog.tsx”）
  - [x] 19.2 新增 `SkillImportItemRow.tsx`，以 item ID 为 key 展示名称/描述/来源/大小/状态/目录改名提示、文件树、分页 UTF-8 预览、可执行列表、能力声明、风险与无效原因（需求 2.11、4.2–4.6；设计“SkillImportItemRow.tsx”）
  - [x] 19.3 实现用户替换、覆盖内置、跳过、大小写冲突禁用、可执行内容确认、稳定决策提交和提交中不可修改/关闭（需求 4.7–4.11、5.1–5.14、6.1–6.5；设计“批量预览工作台”“批次提交校验”）
  - [x] 19.4 实现全批次成功/失败/跳过结果、逐项失败原因和 failed-only 重试；成功后等待 catalog 目标 revision、展开并高亮成功用户技能，刷新完成前禁止关闭（需求 6.18–6.26、7.1–7.5；设计“结果视图”“SkillsSection.tsx”“SkillsCatalogProvider”）

- [x] 20. 实现恢复面板、事务横幅与会话恢复入口（需求 6.11–6.17、6.23；设计“崩溃恢复”“SkillsSection.tsx”“BatchSkillImportDialog.tsx”）
  - [x] 20.1 新增可复用 `RecoveryPanel.tsx`，按 issue 候选只显示合法动作，执行 resolve 后展示 preserved path 并等待 catalog revision（需求 6.12–6.17；设计“崩溃恢复”UI 操作段落、“SkillsSection.tsx”）
  - [x] 20.2 在技能设置页展示异常事务横幅；当成功导入后的刷新被 RecoveryPending 阻塞时在结果视图内嵌恢复面板，全部权威缺失问题解决并刷新成功后才允许关闭（需求 6.13–6.17、6.23；设计“BatchSkillImportDialog.tsx”恢复段落）
  - [x] 20.3 在 Chat UI 识别 `conn-status.code=skill-recovery-pending` 并提供“打开技能恢复”，其他物化失败保持可区分提示（需求 6.13；设计“崩溃恢复”连接状态段落）

- [x] 21. 完成中英文国际化、键盘交互与可访问性（需求 8.1–8.6；设计“IPC 与国际化”“BatchSkillImportDialog.tsx”“Test Strategy / UI”）
  - [x] 21.1 在 `desktop/ui-next/src/lib/i18n/en.ts`、`zh.ts` 补齐来源、摘要、状态、冲突、风险、进度、结果和恢复文案并保持键集合一致（需求 8.1；设计“IPC 与国际化”）
  - [x] 21.2 为列表、展开项、文件树、筛选、冲突动作、风险确认和提交/重试控件添加可访问名称、正确 checkbox/radio/tabpanel 语义与可见焦点顺序（需求 8.2–8.3；设计“批量预览工作台”“SkillImportItemRow.tsx”）
  - [x] 21.3 接入现有 Escape layer：提交前只关闭最高层浮层且不安装，提交/验证/重试期间禁用 Escape 和取消；所有选择、展开、冲突决策及提交可纯键盘完成（需求 8.3–8.5；设计“BatchSkillImportDialog.tsx”）

- [x] 22. 编写并通过前端 IPC、Provider、导航、对话框、恢复和 a11y 自动化测试（需求 8.7；设计“Test Strategy / UI”）
  - [x] 22.1 为 IPC/Provider 编写测试，覆盖监听先于 current、各阶段重载重附着、逆序 snapshot、cancel 墓碑、catalog revision/generation 竞态、跨实例事件及 focus/menu 丢事件校准（需求 1.12、6.23–6.24、8.7；设计“Test Strategy / UI”snapshot 与 catalog 项）
  - [x] 22.2 为设置页、App/NewTaskModal、Composer/SkillsMenu 编写测试，覆盖全部入口精确导航、运行中入口可用但勾选禁用、历史/显式 skills revision 不回退及已挂载选择器同步刷新（需求 1.1–1.4、6.23–6.28、8.7；设计“Test Strategy / UI”入口与会话项）
  - [x] 22.3 为 `BatchSkillImportDialog`/`SkillImportItemRow` 编写测试，覆盖多文件夹/多 ZIP/继续追加、在途禁提交、摘要筛选、全选、重名单选、冲突动作、目录改名、文件树/分页预览、风险确认与提交锁定（需求 1.5–1.15、4.1–4.12、5.1–5.14、8.7；设计“Test Strategy / UI”预览项）
  - [x] 22.4 覆盖部分成功、失败原因/failed-only 重试、成功后 catalog 等待/展开高亮、事务横幅、结果内联恢复、条件动作、preserved path 和 conn-status code 入口（需求 6.11–6.26、8.7；设计“Test Strategy / UI”结果与恢复项）
  - [x] 22.5 覆盖 Escape 分层、键盘选择/展开/冲突/提交、焦点顺序、accessible name 以及中英文 key 完整性（需求 8.1–8.5、8.7；设计“Test Strategy / UI”最后一项）

- [x] 23. 检查点：UI 功能测试、类型检查和 lint 全部通过（需求 8.1–8.7；设计“Test Strategy / 聚焦验证”UI）

- [x] 24. 完成最终自动化验证并修复全部回归（需求 8.6–8.7；设计“Test Strategy / 聚焦验证”）
  - [x] 24.1 运行 `cargo fmt --manifest-path desktop/Cargo.toml -- --check`、`cargo test --manifest-path desktop/Cargo.toml` 以及新增跨进程/平台条件测试，确保技能导入、技能库、事务恢复和会话物化套件全部通过（需求 8.6–8.7；设计“聚焦验证”Rust）
  - [x] 24.2 在 `agent` 运行 `go test ./internal/skills/...`，确保 parser、metadata 和 catalog 对表测试全部通过（需求 2.12–2.13、8.7；设计“聚焦验证”Agent）
  - [x] 24.3 在 `desktop/ui-next` 运行 `npm test`、`npm run typecheck` 和 `npm run lint`，确保 SkillsSection、BatchSkillImportDialog、SkillImportItemRow、SkillsMenu、Provider、Chat 恢复相关自动化验证全部通过（需求 8.1–8.7；设计“聚焦验证”UI）
