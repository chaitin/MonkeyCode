# 无模版设计流实施计划

- [x] 1. 在 MonkeyCodeOfficialPlugins 迁移设计约束
  - [x] 从原 MonkeyDesign 仓库迁移并改造 design-generation、design-refinement、frontend-design、web-design-art-direction、image-generation、image-refinement
  - [x] 新增 design-flow，负责新设计、重设计、Web/Mobile 和纯生图场景编排
  - [x] 将 typography、color、anti-ai-slop、accessibility、state coverage 等规则放入相关 Skill references
  - [x] 复用 visual-design-foundations、web-component-design、react-native-design，避免重复规则
  - [x] 增加 Plugins Skill 结构与流程契约测试

- [x] 2. 让 Desktop 默认提供设计 Skills
  - [x] 将设计 Skills 加入 desktop/src/skills.rs 默认启用集
  - [x] 复用现有 plugins/skills 到 engine_dir/skills 的发现与物化链路
  - [x] 停止默认注入 MC_MONKEYDESIGN_PACKAGE_PATH，保留显式 legacy 调试入口
  - [x] 扩展技能发现、默认启用、用户覆盖、references 复制和会话快照测试

- [x] 3. 在 Agent 中建立无模版设计路由
  - [x] 设计请求直接调用 design-flow，不再强制 Route、Scenario、Template 和 Prepare Contract
  - [x] Agent 约束 Skill 加载、生图、方向确认、实现的执行顺序
  - [x] 保留 MonkeyDesign Package、Contract 和模板搜索代码，但退出默认主流程
  - [x] 更新 prompt 测试，覆盖设计场景和非设计触发边界

- [x] 4. 将图片方向卡从 MonkeyDesign Package 解耦
  - [x] 提取通用 DesignSelectCards 工具并保留 MonkeyDesignSelectCards 兼容包装
  - [x] 保留现有图片安全校验和 Desktop wire 协议
  - [x] interactive 会话独立注册通用图片卡，headless 不注册
  - [x] 更新权限、tools、transport 和 root 测试

- [x] 5. 保持 Desktop 图片卡与设计工作台兼容
  - [x] 继续复用 design/template-selection/request 与 design/selection/respond
  - [x] 将用户可见文案泛化为设计方向，不重构内部协议类型
  - [x] 保持 DesignPreviewWorkbench 截图、标注、元素编辑和反馈链路
  - [x] 运行现有图片卡、历史回放、ChatView 和工作台测试

- [x] 6. 跨仓验证与提交边界
  - [x] 验证 Web、redesign、React Native、纯生图四条路径
  - [x] 验证生图失败、不安全图片和取消选择不会进入实现
  - [x] 验证 legacy MonkeyDesign 可编译但默认流程不加载模板或 Contract
  - [x] 执行 Plugins、Agent、Desktop Rust 和 UI 测试
  - [x] 分别整理 Plugins、Agent 和外层 MonkeyCode 的提交边界及 submodule 指针
