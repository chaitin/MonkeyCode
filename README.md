# MonkeyCode

<p align="center">
  <img src="./frontend/public/logo-dark.png" alt="MonkeyCode" width="200" />
</p>

<p align="center">
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml/badge.svg" alt="Service Images" /></a>
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml/badge.svg" alt="Client Release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
</p>

<p align="center">
  <a href="https://monkeycode-ai.net/">Try Online</a> ·
  <a href="#self-hosted-deployment">Self-Hosted Deployment</a> ·
  <a href="https://discord.gg/8NgHexaaMa">Discord</a> ·
  <a href="./readme.cn.md">中文</a>
</p>

## What Is MonkeyCode?

MonkeyCode is an open-source **enterprise-grade AI development platform** with built-in development environment management, AI model management, AI task management, and project requirement management. Unlike typical vibe coding tools, MonkeyCode is designed as an AI assistant for professional engineering teams.

- You can deploy MonkeyCode inside your **enterprise network** and share it with your R&D team, so developers can start development tasks quickly while engineering leaders manage AI development workflows centrally.
- You can also use our **online environment** directly. It includes managed development environments, built-in large language models, and native mobile support, so you can use leading AI agents anywhere.

## Screenshots

<table>
  <tr>
    <td align="center">
      <img src="./frontend/public/monkeycode-1.png" alt="MonkeyCode AI task workspace" />
      <br />
      <sub>AI Task Workspace</sub>
    </td>
    <td align="center">
      <img src="./frontend/public/monkeycode-2.png" alt="MonkeyCode cloud terminal and task execution" />
      <br />
      <sub>Cloud Terminal and Task Execution</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="./frontend/public/monkeycode-3.png" alt="MonkeyCode project collaboration and file management" />
      <br />
      <sub>Project Collaboration and File Management</sub>
    </td>
    <td align="center">
      <img src="./frontend/public/monkeycode-mobile.png" alt="MonkeyCode mobile task and file management" />
      <br />
      <sub>Mobile Task and File Management</sub>
    </td>
  </tr>
</table>

## Features

You do not need to assemble tools, set up environments, or jump between workflows. Give MonkeyCode a requirement and it carries the work from development to validation, turning AI coding into a sustainable workflow.

- **Free to start**: No client download and no local environment setup. Open the browser, create an account, and start your first AI development task in seconds.
- **Cloud development environments**: No dependency on a local development machine. Every task runs behind a real server-side environment, with build, test, and preview workflows completed in the cloud.
- **Broad model support**: GLM, Kimi, MiniMax, Qwen, DeepSeek, and other mainstream models are integrated. You can switch by task type or select a model manually.
- **Native mobile support**: Deep iOS and Android support keeps PC and mobile data in sync, so agents can continue running tasks while you are away from your desk.
- **Fully open source**: The core code is public on GitHub. Anyone can audit, fork, and extend it while keeping control over technical choices and security policies.
- **Private offline deployment**: Enterprises and teams with strict data privacy requirements can deploy MonkeyCode inside their own networks and keep data local.

## Usage

### Online

Open MonkeyCode Online to get started:

[https://monkeycode-ai.net/](https://monkeycode-ai.net/)

### Self-Hosted Deployment

Recommended configuration:

- MonkeyCode console: at least `2C / 4 GB / 40 GB`
- Development environment host: at least `8C / 16 GB / 100 GB`

Online installation:

```bash
bash -c "$(curl -fsSL 'https://monkeycode-ai.com/online/install')"
```

For more deployment methods, configuration details, and operations guidance, see the [deployment documentation](https://monkeycode.docs.baizhi.cloud/node/019eb0f3-9424-7c93-9489-4e584f989527).

## Comparison

| Dimension | MonkeyCode | Cursor | Claude Code | Codex |
|---|:---:|:---:|:---:|:---:|
| Online usage | 🟢 | 🟢 | 🟢 | 🟢 |
| Local IDE | 🔴 | 🟢 | 🟢 | 🟢 |
| Local CLI | 🔴 | 🟢 | 🟢 | 🟢 |
| Requirement and SPEC management | 🟢 | 🔴 | 🔴 | 🔴 |
| Cloud development environment | 🟢 | 🟡 | 🟡 | 🟡 |
| Code completion | 🔴 | 🟢 | 🔴 | 🔴 |
| Automated PR / MR code review | 🟢 | 🟡 | 🟡 | 🟡 |
| Team collaboration | 🟢 | 🔴 | 🔴 | 🔴 |
| China model support | 🟢 | 🔴 | 🔴 | 🔴 |
| Private deployment | 🟢 | 🔴 | 🔴 | 🔴 |
| Open source | 🟢 | 🔴 | 🔴 | 🔴 |

## Community and Support

Join the community to discuss MonkeyCode usage, deployment, and development with other developers.

<table>
  <tr>
    <td align="center"><img src="./frontend/public/wechat.png" width="160" /><br/>WeChat Group</td>
    <td align="center"><img src="./frontend/public/feishu.png" width="160" /><br/>Feishu Group</td>
    <td align="center"><img src="./frontend/public/dingtalk.png" width="160" /><br/>DingTalk Group</td>
  </tr>
</table>

You can also get support through:

- Documentation: [https://monkeycode.docs.baizhi.cloud/](https://monkeycode.docs.baizhi.cloud/)
- Online service: [https://monkeycode-ai.net/](https://monkeycode-ai.net/)
- Enterprise consultation: [https://baizhi.cloud/consult](https://baizhi.cloud/consult)
- Discord: [https://discord.gg/8NgHexaaMa](https://discord.gg/8NgHexaaMa)
- GitHub Issues: [https://github.com/chaitin/MonkeyCode/issues](https://github.com/chaitin/MonkeyCode/issues)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=chaitin/MonkeyCode&type=Date)](https://star-history.com/#chaitin/MonkeyCode&Date)

## License

MonkeyCode is open source under the [GNU Affero General Public License v3.0](./LICENSE).
