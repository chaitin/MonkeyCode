# MonkeyCode 智能开发平台

MonkeyCode 是一个全新的 AI 编程体验平台，不仅仅是 AI 编程工具，更是对传统研发模式的变革，让你的研发团队效率 Max。

## 技术栈

- **前端框架**: React 19
- **构建工具**: Vite 7
- **开发语言**: TypeScript 5.9
- **样式方案**: Tailwind CSS 4
- **UI 组件**: Radix UI + shadcn/ui
- **路由管理**: React Router 7
- **终端模拟**: xterm.js
- **代码编辑**: Ace Editor
- **Markdown**: MDX Editor

## 功能特性

- 🤖 **AI 任务管理** - 智能任务分配与执行
- 🖥️ **云端开发环境** - 虚拟机管理与远程开发
- 📁 **文件管理** - 在线文件浏览与编辑
- 💻 **Web 终端** - 支持多主题的终端模拟器
- 👥 **团队协作** - 团队成员管理与权限控制
- 🔗 **Git 集成** - 支持 GitHub、GitLab、Gitea、Gitee
- 🎨 **主题切换** - 支持明暗主题

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm build
```

### 预览生产版本

```bash
pnpm preview
```

## 项目结构

```
src/
├── api/                 # API 接口定义（自动生成）
├── components/          # 组件
│   ├── common/          # 通用组件（图标、终端等）
│   ├── console/         # 控制台相关组件
│   │   ├── files/       # 文件管理组件
│   │   ├── nav/         # 导航组件
│   │   ├── project/     # 项目管理组件
│   │   ├── settings/    # 设置组件
│   │   ├── task/        # 任务组件
│   │   └── vm/          # 虚拟机组件
│   ├── manager/         # 管理后台组件
│   ├── ui/              # shadcn/ui 基础组件
│   └── welcome/         # 首页组件
├── hooks/               # 自定义 Hooks
├── lib/                 # 工具库
├── pages/               # 页面
│   ├── console/         # 控制台页面
│   │   ├── manager/     # 团队管理页面
│   │   └── user/        # 用户控制台页面
│   └── ...              # 其他页面
└── utils/               # 工具函数
```

## API 生成

项目使用 [swagger-typescript-api](https://github.com/acacode/swagger-typescript-api) 从 Swagger 文档自动生成 TypeScript API 客户端：

```bash
pnpm api
```

## 相关链接

- [用户文档](https://monkeycode.docs.baizhi.cloud/)
- [获取邀请码](https://monkeycode.docs.baizhi.cloud/node/019a6b8a-ee52-7d69-85fb-a429a8ca40c5)

## License

Private
