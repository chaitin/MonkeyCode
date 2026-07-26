# Online 预览字体稳定性修复设计

## 背景

Online 开发预览可正常加载页面，但界面字体与基准页面存在明显差异。移动端输入栏修复未修改字体族、字号、字重或字距，`frontend/src/main.tsx` 与 `frontend/src/index.css` 相对 `origin/main` 也没有字体相关差异。

## 根因证据

当前预览的检查结果为：

- JetBrains Mono 与 Noto Sans SC 的入口 CSS 返回 200。
- CSS 中的 WOFF2 地址指向 Vite `/@fs/` 路径。
- JetBrains Mono 和 Noto Sans SC 的代表性 WOFF2 请求均返回 403。
- 当前 pnpm 安装将字体包解析到工作区外的全局目录。
- Vite 允许转换已导入的字体 CSS，同时通过文件系统访问边界拦截 CSS 引用的 WOFF2。
- 浏览器因此使用系统回退字体，改变页面的字宽、字形和视觉密度。

## 目标

1. Online 开发预览能够加载项目声明的 JetBrains Mono Variable 与 Noto Sans SC Variable。
2. Vite 只增加两个字体包目录的文件访问权限。
3. 生产构建、全局字体定义和页面字体样式保持现状。
4. 配置测试覆盖字体目录解析和访问白名单。
5. 构建后验收固定检查字体加载状态与视觉一致性。

## 方案比较

### 方案 A：限定字体包目录的文件访问权限

Vite 启动时通过模块解析获得两个字体包的实际目录，并将其加入 `server.fs.allow`。目录从当前依赖安装结果动态获得，配置中不写入机器相关绝对路径。

优点：

- 权限范围限定到两个字体包
- 保留现有字体依赖和 CSS
- 同时适配普通本地安装与当前全局 pnpm 链接
- 生产构建继续由 Vite复制字体资源

代价：开发服务配置需要维护字体包白名单。

### 方案 B：保留依赖符号链接路径

启用 Vite `resolve.preserveSymlinks`，使字体资源沿工作区内的符号链接路径解析。

代价：该选项会影响所有依赖的模块身份和去重行为，React 等运行时依赖存在重复实例风险。

### 方案 C：复制字体文件到 public

将字体及 CSS 固定到 `frontend/public/fonts/`。

代价：Noto Sans SC 包含大量 Unicode 子集，仓库体积与升级维护成本都会增加。

采用方案 A。

## 配置设计

`frontend/vite.config.ts` 提供一个独立函数，解析以下包入口所在目录：

- `@fontsource-variable/jetbrains-mono`
- `@fontsource-variable/noto-sans-sc`

解析结果经过规范化和去重后写入 `server.fs.allow`。函数不接受用户输入，也不读取环境变量中的路径。解析失败时 Vite 启动立即报错，避免页面带着回退字体进入验收。

项目根目录保持在 allow 列表中，确保 Vite 的默认工作区访问能力不受自定义列表覆盖。其他工作区外路径不进入列表。

## 安全边界

- 白名单来源固定为代码内声明的两个字体包。
- 配置不允许通过请求参数或环境变量扩展文件系统目录。
- 白名单使用包目录粒度，不允许 pnpm store 根目录或用户目录。
- 浏览器只能通过 Vite 已有静态资源处理链请求允许目录中的文件。
- API 代理、认证、验证码和生产服务配置保持现状。

## 测试设计

### 配置测试

1. 字体目录解析结果包含 JetBrains Mono 与 Noto Sans SC 的包目录。
2. 结果包含项目根目录，保留 Vite 默认工作区访问能力。
3. 结果经过规范化和去重。
4. 结果不包含 pnpm store 根目录、用户目录或其他宽泛父目录。

### 自动验证

1. Online build 成功并继续输出两套字体的 WOFF2 资源。
2. 重启 online 开发预览后，两套字体的代表性 WOFF2 请求返回 200 和字体 MIME 类型。
3. 完整 ESLint、聚焦测试与全量测试失败基线保持稳定。

### 人工验收

1. 等待 `document.fonts.ready`。
2. 确认 `document.fonts.check()` 可识别 JetBrains Mono Variable 与 Noto Sans SC Variable。
3. 检查 Network 与控制台中没有字体资源失败。
4. 在 320px、375px、390px、430px 和 1280px 对照基准页面核对字体族、字号、字重和行高。
5. 字体通过后继续验证码登录和输入栏重叠验收。

## 工作流记录

更新 `.monkeycode/MEMORY.md` 的 Online 预览验收条目，将字体加载状态、字体资源响应和多宽度视觉对照列为构建后高频回归项。

## 非目标

- 调整全局字体族或字体优先级
- 修改字号、字重、行高或字距
- 更换字体供应包
- 修改生产页面设计语言
- 扩大 Vite 对工作区外目录的通用访问权限
