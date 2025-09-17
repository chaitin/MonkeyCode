# Monkey Code UI

> 一个现代化的代码开发平台前端应用，基于 React 19 和 TypeScript 构建，提供智能代码统计、用户管理、AI模型管理等核心功能。

[![React](https://img.shields.io/badge/React-19.1.0-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.3.5-646CFF.svg)](https://vitejs.dev/)
[![Material-UI](https://img.shields.io/badge/Material--UI-6.4.12-0081CB.svg)](https://mui.com/)

## ✨ 功能特性

### 📊 数据统计
- **全局统计**: 系统整体数据分析和可视化展示
- **成员统计**: 用户个人数据统计和活动分析
- **多维度图表**: 柱状图、折线图、饼图等多种数据展示方式

### 💬 智能交互
- **聊天功能**: 实时消息交流和会话管理
- **完成状态**: 任务完成情况跟踪和结果展示

### 🤖 模型管理
- **模型配置**: AI模型参数设置和管理
- **使用统计**: 模型调用次数和Token使用量统计
- **性能监控**: 模型响应时间和成功率监控

### 👥 用户管理
- **用户注册**: 完整的用户注册和认证流程
- **权限管理**: 基于角色的访问控制(RBAC)
- **邀请系统**: 用户邀请和团队管理
- **登录历史**: 用户登录记录和安全审计

### 🛡️ 管理后台
- **系统管理**: 全面的系统配置和监控
- **用户管理**: 管理员用户操作和权限分配
- **数据分析**: 深度业务数据分析和报表

## 🛠️ 技术栈

### 前端框架
- **React 19** - 最新的React框架，支持Concurrent Features
- **TypeScript** - 类型安全的JavaScript超集
- **Vite** - 现代化的前端构建工具

### UI框架与样式
- **Material-UI (@mui)** - Google Material Design组件库
- **Emotion** - CSS-in-JS样式库
- **@ctzhian/ui** - 自定义组件库

### 状态管理与数据
- **ahooks** - React Hooks工具库
- **react-hook-form** - 高性能表单管理
- **axios** - HTTP客户端库

### 路由与导航
- **react-router-dom v7** - 声明式路由管理

### 数据可视化
- **ECharts** - 功能强大的图表库
- **react-activity-calendar** - 活动日历组件

### 工具库
- **dayjs** - 轻量级日期处理库
- **decimal.js** - 精确数值计算
- **lottie-react** - 动画效果库
- **react-markdown** - Markdown渲染器
- **react-syntax-highlighter** - 代码高亮显示

## 📁 项目结构

```
ui/
├── src/
│   ├── api/                    # API请求层
│   │   ├── Billing.ts         # 计费相关API
│   │   ├── Dashboard.ts       # 仪表盘API
│   │   ├── Model.ts           # 模型管理API
│   │   ├── OpenAiv1.ts        # OpenAI接口
│   │   ├── User.ts            # 用户管理API
│   │   ├── httpClient.ts      # HTTP客户端配置
│   │   └── types.ts           # API类型定义
│   ├── assets/                # 静态资源
│   │   ├── fonts/             # 字体文件
│   │   ├── images/            # 图片资源
│   │   ├── json/              # JSON配置文件
│   │   └── styles/            # 全局样式
│   ├── components/            # 公共组件
│   │   ├── avatar/            # 头像组件
│   │   ├── card/              # 卡片组件
│   │   ├── form/              # 表单组件
│   │   ├── header/            # 头部组件
│   │   ├── lottieIcon/        # 动画图标
│   │   ├── markDown/          # Markdown渲染
│   │   └── sidebar/           # 侧边栏组件
│   ├── layouts/               # 布局组件
│   │   └── mainLayout/        # 主布局
│   ├── pages/                 # 页面组件
│   │   ├── admin/             # 管理员页面
│   │   ├── auth/              # 认证页面
│   │   ├── chat/              # 聊天页面
│   │   ├── completion/        # 完成页面
│   │   ├── dashboard/         # 仪表盘页面
│   │   ├── expectation/       # 期望页面
│   │   ├── invite/            # 邀请页面
│   │   ├── login/             # 登录页面
│   │   ├── model/             # 模型管理页面
│   │   └── user/              # 用户管理页面
│   ├── utils/                 # 工具函数
│   ├── router.tsx             # 路由配置
│   ├── theme.ts               # 主题配置
│   └── main.tsx               # 应用入口
├── public/                    # 公共资源
├── api-templates/             # API模板
├── scripts/                   # 构建脚本
├── vite.config.ts             # Vite配置
├── tsconfig.json              # TypeScript配置
├── eslint.config.js           # ESLint配置
└── package.json               # 项目依赖
```

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **pnpm** >= 7.0.0 (推荐使用pnpm作为包管理器)

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd monkey-code-ui
```

2. **安装依赖**
```bash
pnpm install
```

3. **启动开发服务器**
```bash
pnpm dev
```

4. **访问应用**
打开浏览器访问: `http://localhost:3300`

### 环境配置

创建 `.env` 文件配置环境变量：

```bash
# API服务地址
VITE_API_BASE_URL=http://localhost:8080/

# 其他环境变量...
```

## 📝 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 (端口: 3300) |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产构建结果 |
| `pnpm lint` | 运行ESLint代码检查 |
| `pnpm api` | 生成API接口代码 |
| `pnpm icon` | 下载图标资源 |

## 🏗️ 构建部署

### 生产构建

```bash
pnpm build
```

构建产物将生成在 `dist/` 目录中。

### Docker 部署

项目包含 `nginx.conf` 配置文件，可用于 Docker 容器化部署：

```bash
# 构建Docker镜像
docker build -t monkey-code-ui .

# 运行容器
docker run -p 80:80 monkey-code-ui
```

## 🔧 开发指南

### 代码规范

- 使用 **TypeScript** 进行类型检查
- 遵循 **ESLint** 代码规范
- 使用 **Prettier** 格式化代码
- 采用 **函数式组件** + **Hooks** 开发模式

### API 集成

项目使用统一的API客户端配置，支持：
- 请求/响应拦截器
- 错误处理
- 类型安全的接口定义

### 主题定制

在 `src/theme.ts` 中配置Material-UI主题：
- 颜色方案
- 字体设置
- 组件样式覆盖

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request


## 📞 联系方式

如有问题或建议，请联系开发团队。
