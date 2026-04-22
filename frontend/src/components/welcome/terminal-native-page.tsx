import { useAuth } from "@/components/auth-provider";
import Icon from "@/components/common/Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconArrowRight, IconFile, IconFilePencil, IconFolder, IconFolderOpen, IconSend } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";
import { TerminalFooter, TerminalHeader } from "./terminal-chrome";

const GITHUB_LINK = "https://github.com/chaitin/MonkeyCode/";
const CONSULT_LINK = "https://baizhi.cloud/consult";

const themeVars = {
  "--a-bg": "#0a0d0a",
  "--a-bg-2": "#0d1210",
  "--a-panel": "#111814",
  "--a-line": "#1d2a22",
  "--a-line-2": "#243329",
  "--a-fg": "#c9d6cc",
  "--a-fg-dim": "#7a8c80",
  "--a-fg-mute": "#4a5b50",
  "--a-accent": "#7cf29c",
  "--a-accent-dim": "#3ba863",
  "--a-warn": "#f7b955",
  "--a-danger": "#ff6b6b",
  "--a-info": "#61dafb",
  "--a-magenta": "#ff6b9d",
  "--a-purple": "#c39bff",
} as React.CSSProperties;

const featureItems = [
  {
    key: "01",
    cmd: "--free --no-install",
    title: "免费即用",
    body: "无需下载客户端，也不用折腾环境。浏览器打开、注册账号，几秒钟就能开始执行第一个 AI 开发任务。",
  },
  {
    key: "02",
    cmd: "--cloud --dedicated",
    title: "云端开发环境",
    body: "不依赖本地开发机。每个任务背后都有一台真实服务器提供运行环境，编译、测试、预览都在云上完成。",
  },
  {
    key: "03",
    cmd: "--models --all-major",
    title: "全量主流模型",
    body: "GPT、Claude、GLM、Kimi、MiniMax、Qwen、DeepSeek 等都已接入，按任务类型切换，也能手动指定。",
  },
  {
    key: "04",
    cmd: "--mobile --cross-device",
    title: "移动端原生支持",
    body: "深度适配 iOS / Android，PC 和手机数据实时同步。通勤路上也能把任务交给 Agent 继续跑。",
  },
  {
    key: "05",
    cmd: "--opensource --auditable",
    title: "完全开源",
    body: "核心代码全部公开在 GitHub。任何人都能审计、fork、二次开发，技术选型和安全策略自己掌控。",
  },
  {
    key: "06",
    cmd: "--self-host --air-gapped",
    title: "私有化离线部署",
    body: "对数据隐私要求高的企业和团队，可以把 MonkeyCode 独立部署到自己的内网中，数据不出本地。",
  },
];

const useCaseItems = [
  {
    tag: "game",
    cmd: '$ monkey task "用 canvas 做一个俄罗斯方块"',
    title: "做个小游戏",
    body: "一句话描述玩法，AI 帮你搭框架、处理碰撞检测、补音效，一个下午就能跑出可玩的版本。",
    stack: ["HTML5 · Canvas", "TypeScript", "零依赖"],
  },
  {
    tag: "feature",
    cmd: '$ monkey task "给后台加一个用户导出 CSV 的接口"',
    title: "实现一个需求",
    body: "把需求丢进去，AI 读你的代码仓库、理解项目约定，直接改文件、跑测试、开 PR。",
    stack: ["读懂代码风格", "自动写单测", "一键开 PR"],
  },
  {
    tag: "security",
    cmd: "$ monkey scan --security ./my-repo",
    title: "安全审查",
    body: "上线前做一次体检。AI 扫常见漏洞、硬编码密钥、依赖风险，输出可修复的清单。",
    stack: ["OWASP Top 10", "依赖 CVE", "SAST 规则"],
  },
  {
    tag: "paper",
    cmd: '$ monkey write --paper "基于 XX 方法的 XX 研究"',
    title: "写毕业论文",
    body: "帮你查文献、列提纲、补实验代码、跑数据、画图、排版 LaTeX，从选题到定稿都能接力。",
    stack: ["文献检索", "实验脚本", "LaTeX 排版"],
  },
  {
    tag: "data",
    cmd: "$ monkey analyze sales_2026.csv",
    title: "数据分析",
    body: "丢一份 CSV 或 Parquet，描述你想看的角度。AI 自动清洗、建模、画图，再写一段可读结论。",
    stack: ["Pandas / Polars", "Matplotlib", "自动写结论"],
  },
  {
    tag: "research",
    cmd: '$ monkey research "2026 年最佳向量数据库对比"',
    title: "产品 / 技术调研",
    body: "AI 拉公开资料、跑 benchmark、出对比报告，带引用链接，适合做技术选型和产品预研。",
    stack: ["公开资料聚合", "横向对比", "带引用"],
  },
];

const compareColumns = ["MonkeyCode", "Cursor", "Claude Code", "Codex"];

const compareRows = [
  { label: "在线使用", values: [1, 1, 1, 1] },
  { label: "本地 IDE", values: [0, 1, 1, 1] },
  { label: "本地 CLI", values: [0, 1, 1, 1] },
  { label: "需求与 SPEC 管理", values: [1, 0, 0, 0] },
  { label: "云端开发环境", values: [1, 2, 2, 2] },
  { label: "代码补全", values: [0, 1, 0, 0] },
  { label: "PR / MR 自动代码审查", values: [1, 2, 2, 2] },
  { label: "团队协作", values: [1, 0, 0, 0] },
  { label: "适配国产大模型", values: [1, 0, 0, 0] },
  { label: "私有化部署", values: [1, 0, 0, 0] },
  { label: "开源", values: [1, 0, 0, 0] },
];

const testimonialItems: Array<{
  quote: string;
  name: string;
  role: string;
  stat?: string;
}> = [
  {
    quote:
      "用起来有点像 OpenCode 和 Coze 的结合体。最良心的是提供了隔离的运行环境，启动非常快，编译完成后还能直接生成一个可对外访问的网址。你可以高度自由地配置自己的模型，当然它也内置了免费且高性价比的模型。自带很多实用的技能，上手简单又方便。最关键的是，它是一款开源产品，能陪你一起成长。",
    name: "aiwenming",
    role: "产品管理",
  },
  {
    quote:
      "Vibe Coding 是一个全新的时代，告别闷热、逼窒的小格子，到更广阔的天地去，呼吸着自由的空气。即使是出差在路上，也只需带一个轻薄本或 iPad，使用 MonkeyCode，轻松在云端跑着复杂的编码工作。",
    name: "弈韬",
    role: "和旭电商 · 电商运营",
  },
  {
    quote:
      "MonkeyCode 的云开发环境体验出色，Agent 能连接终端自主思考执行，真正实现“甩手掌柜”式编程。免费提供 MiniMax 和千问模型，响应快、调用无限制，相比别家月底掐算 Token 的日子一去不复返。",
    name: "Full",
    role: "安全工程师",
  },
  {
    quote:
      "MonkeyCode 是一款定位独特的 AI 编程平台，它不仅仅是一个代码补全工具，更致力于成为一个覆盖“需求 → 设计 → 开发 → 评审”全流程的 AI 研发基础设施。其核心价值在于通过自动化和云端环境，改变传统的研发工作流，尤其适合我们这种传统性开发公司，提供了全流程支撑。",
    name: "李宏喜",
    role: "零商界网络科技 · 总经理",
  },
  {
    quote:
      "很喜欢 MonkeyCode 这种云端轻量级开发模式，开发都不用打开本地 IDE，未跑完的任务手机打开也可以接着跑，满足随时随地都可以开发的需求，而且还内置了各种主流模型、Skills、MCP 等供开发者自由选择，这也是未来的趋势。",
    name: "Clever",
    role: "中国电信 · 全栈工程师",
  },
  {
    quote:
      "MonkeyCode 是我日常写项目、做课设的首选，AI 辅助生成效率很高，环境秒级启动，不用折腾本地配置。对学生党特别友好，很多复杂功能拖拽加描述就能搞定，节省了大量查文档的时间。",
    name: "司徒北",
    role: "独立开发者",
  },
  {
    quote:
      "之前让其他 AI 写代码还要自己不断测试，现在直接让 MonkeyCode 接入我的服务器自动进行写代码和测试就可以，还能自动根据测试的内容给我进行反馈，节省很多人为时间。",
    name: "sinian-liu",
    role: "37VPS · 创始人",
  },
  {
    quote:
      "以往光配置环境就耗费大量时间，低效又繁琐。使用 MonkeyCode 后省去大量无效劳动，开箱即用，可直接专注业务开发，流程顺畅，大幅提升开发体验与效率。",
    name: "时光旅人",
    role: "独立开发者",
  },
  {
    quote:
      "上手零门槛，注册就能用，关键还免费。不用安装任何环境，打开浏览器就能在线编程，从需求到开发、测试到交付，包括终端调试和代码提交，几轮对话就能全部搞定。再也不用背着电脑到处跑了。",
    name: "不开灯的街",
    role: "技术负责人",
  },
  {
    quote:
      "MonkeyCode 是一款 AI 本位的开发工具，提供可落地的 AI + Dev 全链路开发能力。它不仅能帮助我写代码，还能理解项目、执行任务、协助调试，让我把更多时间和精力留给创意。",
    name: "小谈谈",
    role: "OPC 创业者",
  },
  {
    quote:
      "以前带新人做项目，第一步总是先花半天配环境。现在直接把需求和仓库交给 MonkeyCode，大家在同一套云端环境里推进，少了很多无意义的折腾，协作效率高很多。",
    name: "南山",
    role: "阿里巴巴 · 技术负责人",
  },
  {
    quote:
      "我最看重的是它不挑设备。办公室用电脑，回家用平板，临时出门用手机看进度，任务都能接着跑。对经常要在多个场景切换的人来说，这种连续性真的很舒服。",
    name: "阿杰",
    role: "独立开发者",
  },
];

const pricingTiers = [
  {
    name: "基础版",
    cmd: "monkey account --free",
    price: "¥0",
    unit: "永久免费",
    sub: "永久免费",
    desc: "可直接免费使用，适合轻度体验。",
    features: ["1 个并发任务", "云开发环境 1C / 4GB", "支持部分大模型", "注册赠送 5000 积分"],
    cta: "免费开始",
    ctaTo: "/console",
  },
  {
    name: "专业版",
    cmd: "monkey account --pro",
    price: "10,000",
    unit: "积分 / 月",
    sub: "≈ ¥50 / 月",
    desc: "适合日常开发，能力更强，额度适中。",
    features: ["3 个并发任务", "云开发环境 2C / 8GB", "每天赠送 2,000 积分（当日有效）", "可使用全部大模型", "AI 响应速度更快", "更多内置 AI 能力"],
    cta: "订阅专业版",
    ctaTo: "/console",
    featured: true,
  },
  {
    name: "旗舰版",
    cmd: "monkey account --ultra",
    price: "100,000",
    unit: "积分 / 月",
    sub: "≈ ¥400 / 月",
    desc: "适合重度使用，能力更强，额度更高。",
    features: ["3 个并发任务", "云开发环境 2C / 8GB", "每天赠送 30,000 积分（当日有效）", "可使用全部大模型", "AI 响应速度更快", "更多内置 AI 能力"],
    cta: "订阅旗舰版",
    ctaTo: "/console",
  },
];

const earnWays = [
  { icon: "★", label: "注册即送", value: "5000 积分" },
  { icon: "↗", label: "每邀请 1 位新用户", value: "+5000 积分" },
  { icon: "✓", label: "每日签到", value: "持续积累" },
  { icon: "✎", label: "分享使用故事", value: "1 万 - 10 万积分" },
];

const rechargeTiers = [
  { amount: "¥50", points: "1 万积分", extra: "" },
  { amount: "¥200", points: "5 万积分", extra: "8 折" },
  { amount: "¥1000", points: "30 万积分", extra: "6.7 折" },
];

const faqItems = [
  {
    question: "真的完全免费？怎么赚钱？",
    answer: "个人 Free tier 长期可用。我们主要通过 Pro 订阅和企业自托管商业支持赚钱，核心推理成本平台侧承担。",
  },
  {
    question: "代码会不会被拿去训练模型？",
    answer: "默认不会。你的仓库、prompt 和输出默认不进入任何模型训练流程。自托管版本数据也不会出你的网络。",
  },
  {
    question: "支持哪些模型？",
    answer: "平台已接入 GPT、Claude、GLM、Kimi、MiniMax、Qwen、DeepSeek 等主流模型，也支持第三方兼容接口。",
  },
  {
    question: "离线能用吗？",
    answer: "主站依赖云端算力，需要网络。自托管版本可以部署在内网环境，模型也可以走本地 Ollama 或 vLLM。",
  },
  {
    question: "和 Cursor / Copilot / Codex 有什么不同？",
    answer: "它们更偏本地 IDE 插件或 CLI，环境仍然由你自己维护。MonkeyCode 是云端 agent + 云端运行时，你只需要浏览器。",
  },
  {
    question: "我能用在生产项目上吗？",
    answer: "可以。所有修改都可以回到 Git PR 流程，你保留完整 review、审计和 rollback 能力。",
  },
];

type HeroFileTreeItem = {
  name: string;
  type: "folder" | "file";
  indent?: number;
  open?: boolean;
  dot?: string;
  active?: boolean;
};

const heroContextUsage = 70;

const heroFileTree: HeroFileTreeItem[] = [
  { name: "src", type: "folder", open: true },
  { name: "world", type: "folder", indent: 1, open: true },
  { name: "chunk.ts", type: "file", indent: 2, dot: "var(--a-warn)" },
  { name: "terrain.ts", type: "file", indent: 2, dot: "var(--a-accent)" },
  { name: "inventory.ts", type: "file", indent: 2 },
  { name: "App.tsx", type: "file", indent: 1 },
  { name: "main.tsx", type: "file", indent: 1 },
  { name: "textures", type: "folder", indent: 1 },
  { name: "tests", type: "folder" },
  { name: "package.json", type: "file" },
  { name: "README.md", type: "file" },
];

function SectionShell({
  id,
  index,
  label,
  title,
  subtitle,
  children,
}: {
  id: string;
  index: string;
  label: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-[1280px] px-5 py-14 sm:px-8 sm:py-20">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[11px] tracking-[0.22em] text-[var(--a-accent)]">{index}</span>
        <span className="text-[11px] tracking-[0.22em] text-[var(--a-fg-mute)]">// {label}</span>
        <div className="h-px flex-1 bg-gradient-to-r from-[var(--a-line-2)] to-transparent" />
      </div>
      <h2 className="max-w-[820px] text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--a-fg)] sm:text-4xl lg:text-[44px]">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-4 w-full text-sm leading-7 text-[var(--a-fg-dim)] sm:text-[15px] sm:leading-8">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function BlinkCursor() {
  return <span className="mc-blink inline-block h-[0.95em] w-[0.55em] align-middle bg-[var(--a-accent)]" />;
}

function PromptLine({
  path = "~",
  children,
  className,
}: {
  path?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-[13px] leading-7 text-[var(--a-fg)]", className)}>
      <span className="text-[var(--a-accent)]">dev@monkey</span>
      <span className="text-[var(--a-fg-dim)]">:</span>
      <span className="text-[var(--a-info)]">{path}</span>
      <span className="text-[var(--a-fg-dim)]"> $ </span>
      <span>{children}</span>
    </div>
  );
}

function HeaderAction({
  to,
  href,
  external,
  children,
  primary,
}: {
  to?: string;
  href?: string;
  external?: boolean;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const className = cn(
    "inline-flex items-center justify-center gap-2 rounded-[4px] border px-3.5 py-2 text-[13px] transition-colors",
    primary
      ? "border-[rgba(124,242,156,0.3)] bg-[var(--a-accent)] text-[var(--a-bg)] shadow-[0_0_24px_rgba(124,242,156,0.24)] hover:bg-[#93f7ae]"
      : "border-[var(--a-line-2)] bg-[var(--a-panel)] text-[var(--a-fg)] hover:bg-[#162019] hover:text-white"
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={className}>
      {children}
    </a>
  );
}

export default function TerminalNativePage() {
  const { isLoggedIn } = useAuth();
  const [openFaq, setOpenFaq] = React.useState(0);

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-[var(--a-bg)] text-[var(--a-fg)]"
      style={{ ...themeVars, wordBreak: "normal" }}
    >
      <style>{`
        @keyframes mc-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes mc-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .mc-blink { animation: mc-blink 1s steps(2) infinite; }
        .mc-pulse { animation: mc-pulse 1.5s infinite; }
      `}</style>

      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at top, rgba(124,242,156,0.08), transparent 34%), radial-gradient(circle at 20% 12%, rgba(124,242,156,0.1), transparent 24%), radial-gradient(circle at 80% 16%, rgba(97,218,251,0.08), transparent 22%), linear-gradient(180deg, #0a0d0a 0%, #0a0d0a 100%)",
          }}
        />
        <div
          className="absolute inset-0 mix-blend-screen opacity-40"
          style={{
            background:
              "repeating-linear-gradient(0deg, rgba(124,242,156,0.02) 0px, rgba(124,242,156,0.02) 1px, transparent 1px, transparent 3px)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.45) 100%)" }}
        />
      </div>

      <TerminalHeader />

      <main className="relative z-10 pt-[88px] sm:pt-[92px]">
        <section id="hero" className="mx-auto max-w-[1280px] px-5 pb-10 pt-8 sm:px-8 sm:pt-12 sm:pb-16">
          <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
            <div className="relative">
              <div className="pointer-events-none absolute left-[18%] top-[8%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(124,242,156,0.12),transparent_70%)] blur-3xl" />
              <div className="relative">
                <h1 className="text-4xl font-semibold leading-[1.03] tracking-[-0.04em] text-white sm:text-5xl lg:text-[68px]">
                  <span>Monkey</span>
                  <span className="text-[var(--a-accent)] [text-shadow:0_0_24px_rgba(124,242,156,0.35)]">Code</span>
                </h1>
                <p className="mt-4 max-w-[540px] text-2xl font-medium leading-[1.08] tracking-[-0.03em] text-[var(--a-fg)] sm:text-[30px]">
                  在线 AI 开发平台
                </p>
                <p className="mt-5 max-w-[540px] text-sm leading-8 text-[var(--a-fg-dim)] sm:text-[15px]">
                  免费使用，无需安装，内置云端开发环境，并支持业内最全的顶尖大模型。无论是开发项目、做调研、写文档，还是分析数据、处理任务，打开浏览器就能随时开始，让 AI 持续帮你推进工作。
                </p>

                <div className="mt-9 flex flex-wrap gap-3">
                  <HeaderAction to="/console" primary>
                    <IconArrowRight className="size-4" />
                    <span>开始使用</span>
                  </HeaderAction>
                  <HeaderAction href={GITHUB_LINK} external>
                    <Icon name="GitHub-Uncolor" className="size-4 fill-current" />
                    <span>GitHub</span>
                  </HeaderAction>
                </div>

              </div>
            </div>

            <HeroTerminalCard />
          </div>
        </section>

        <SectionShell
          id="features"
          index="01"
          label="FEATURES"
          title="功能与特色"
          subtitle="你不需要自己拼工具、搭环境、来回切流程。把需求交给 MonkeyCode，它会从开发到验证一路接住，真正把 AI 编程变成可持续的工作流。"
        >
          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-line)] md:grid-cols-2 lg:grid-cols-3">
            {featureItems.map((item) => (
              <div
                key={item.key}
                className="group min-h-[220px] bg-[var(--a-panel)] p-7 transition-colors hover:bg-[rgba(124,242,156,0.03)]"
              >
                <div className="mb-6 flex items-baseline justify-between gap-4">
                  <span className="text-[10px] tracking-[0.14em] text-[var(--a-fg-mute)]">{item.key}</span>
                  <span className="text-[10px] tracking-[0.08em] text-[var(--a-accent)] opacity-60 transition-opacity group-hover:opacity-100">
                    {item.cmd}
                  </span>
                </div>
                <h3 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--a-accent)] transition-[text-shadow] group-hover:[text-shadow:0_0_18px_rgba(124,242,156,0.4)]">
                  {item.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-[var(--a-fg-dim)]">{item.body}</p>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="usecases"
          index="02"
          label="USE CASES"
          title="能在 MonkeyCode 上做什么？"
          subtitle="从正经项目到灵感试验，从白天的工作任务到晚上的个人想法，只要你说清目标，MonkeyCode 就能陪你把它真正做出来。"
        >
          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--a-line-2)] bg-[var(--a-line)] md:grid-cols-2 lg:grid-cols-3">
            {useCaseItems.map((item, index) => (
              <div
                key={item.title}
                className="group flex min-h-[280px] flex-col bg-[var(--a-panel)] p-7 transition-colors hover:bg-[rgba(124,242,156,0.035)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.14em] text-[var(--a-fg-mute)]">CASE / {String(index + 1).padStart(2, "0")}</span>
                  <span className="rounded border border-[rgba(124,242,156,0.15)] bg-[rgba(124,242,156,0.06)] px-2 py-0.5 text-[10px] tracking-[0.08em] text-[var(--a-accent)]">
                    #{item.tag}
                  </span>
                </div>
                <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--a-accent)] transition-[text-shadow] group-hover:[text-shadow:0_0_14px_rgba(124,242,156,0.4)]">
                  {item.title}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-[var(--a-fg-dim)]">{item.body}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.stack.map((tag) => (
                    <span key={tag} className="rounded border border-[var(--a-line-2)] px-2 py-1 text-[11px] text-[var(--a-fg-dim)]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="why"
          index="03"
          label="WHY MONKEYCODE"
          title="和其他 Coding 工具的区别"
          subtitle="和依赖本地 IDE、CLI 或开发环境的工具不同，MonkeyCode 打开浏览器就能随时开始开发，并支持围绕同一个项目持续迭代、长期管理与协作。"
        >
          <div className="overflow-x-auto rounded-md border border-[var(--a-line-2)] bg-[var(--a-panel)]">
            <table className="min-w-[900px] w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--a-line-2)] bg-[var(--a-bg-2)]">
                  <th className="px-5 py-4 text-left text-[11px] tracking-[0.12em] text-[var(--a-fg-mute)]"># 对比维度</th>
                  {compareColumns.map((column, index) => (
                    <th
                      key={column}
                      className={cn(
                        "px-3 py-4 text-center text-xs font-medium tracking-[0.06em]",
                        index === 0
                          ? "border-x border-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.04)] text-[var(--a-accent)]"
                          : "border-l border-[var(--a-line)] text-[var(--a-fg)]"
                      )}
                    >
                      <div className="relative">
                        {column}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row, rowIndex) => (
                  <tr key={row.label} className={rowIndex % 2 === 1 ? "bg-[rgba(255,255,255,0.012)]" : ""}>
                    <td className="border-b border-[var(--a-line)] px-5 py-4 text-sm text-[var(--a-fg)]">{row.label}</td>
                    {row.values.map((value, cellIndex) => (
                      <td
                        key={`${row.label}-${cellIndex}`}
                        className={cn(
                          "border-b border-[var(--a-line)] px-3 py-4 text-center",
                          cellIndex === 0
                            ? "border-x border-x-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.04)]"
                            : "border-l border-l-[var(--a-line)]"
                        )}
                      >
                        {value === 1 ? (
                          <span className="inline-flex size-[18px] items-center justify-center rounded-[3px] bg-[var(--a-accent)] text-[11px] font-bold text-[var(--a-bg)]">
                            ✓
                          </span>
                        ) : value === 2 ? (
                            <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex size-[18px] cursor-help items-center justify-center rounded-[3px] bg-[rgba(247,185,85,0.72)] text-[11px] font-bold text-[var(--a-bg)]">
                                ✓
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>仅支持部分能力</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="inline-flex size-[18px] items-center justify-center text-[13px] text-[var(--a-fg-mute)]">✕</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-[11px] tracking-[0.04em] text-[var(--a-fg-mute)]">
            // 数据基于各产品公开特性整理，如有遗漏欢迎提 issue 或 PR
          </div>
        </SectionShell>

        <SectionShell
          id="testimonials"
          index="04"
          label="WHAT DEVS SAY"
          title="用户真实评价"
          subtitle="来自真实用户的使用反馈，覆盖开发、运营、创业、团队协作等不同场景。"
        >
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {[...testimonialItems].sort((a, b) => a.quote.length - b.quote.length).map((item) => (
              <div key={item.name} className="relative flex h-full flex-col rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
                <div className="absolute left-5 top-4 text-4xl leading-none text-[var(--a-accent-dim)] opacity-40">❝</div>
                <p className="relative flex-1 text-sm leading-7 text-[var(--a-fg)]">{item.quote}</p>
                <div className="mt-5 border-t border-dashed border-[var(--a-line-2)] pt-4">
                  <div className="text-sm text-[var(--a-accent)]">{item.name}</div>
                  <div className="mt-1 text-[13px] text-[var(--a-fg-dim)]">{item.role}</div>
                  {item.stat ? (
                    <div className="mt-1 text-[11px] tracking-[0.06em] text-[var(--a-fg-mute)]">{item.stat}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="pricing"
          index="05"
          label="PRICING"
          title="套餐与费用"
          subtitle="个人用户可以直接免费使用；需要更高额度或团队能力时，再按积分灵活升级。"
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={cn(
                  "relative flex h-full flex-col rounded-md border p-7",
                  tier.featured
                    ? "border-[var(--a-accent-dim)] bg-[var(--a-panel)] shadow-[0_0_40px_rgba(124,242,156,0.1)]"
                    : "border-[var(--a-line)] bg-[var(--a-bg-2)]"
                )}
              >
                {tier.featured ? (
                  <div className="absolute right-5 top-[-10px] rounded bg-[var(--a-accent)] px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--a-bg)]">
                    推荐
                  </div>
                ) : null}
                <div className="text-[11px] tracking-[0.08em] text-[var(--a-fg-mute)]">$ {tier.cmd}</div>
                <div className="mt-2 text-[22px] font-semibold text-[var(--a-fg)]">{tier.name}</div>
                <div className="mt-5 flex items-end gap-2">
                  <span
                    className={cn(
                      "font-semibold leading-none tracking-[-0.04em] text-[var(--a-accent)]",
                      tier.price.length > 5 ? "text-[32px]" : "text-[40px]"
                    )}
                  >
                    {tier.price}
                  </span>
                  <span className="pb-1 text-sm text-[var(--a-fg-dim)]">{tier.unit}</span>
                </div>
                {tier.sub ? <div className="mt-1 text-[11px] tracking-[0.04em] text-[var(--a-fg-mute)]">{tier.sub}</div> : null}
                <p className="mt-4 text-[12.5px] leading-[1.6] text-[var(--a-fg-dim)]">{tier.desc}</p>
                <div className="mt-5 flex-1 space-y-2">
                  {tier.features.map((feature) => (
                    <div key={feature} className="text-[12.5px] text-[var(--a-fg)]">
                      <span className="mr-2 text-[var(--a-accent)]">✓</span>
                      {feature}
                    </div>
                  ))}
                </div>
                <Link
                  to={tier.ctaTo}
                  className={cn(
                    "mt-6 inline-flex w-full items-center justify-center rounded border px-4 py-3 text-sm font-semibold transition-colors",
                    tier.featured
                      ? "border-transparent bg-[var(--a-accent)] text-[var(--a-bg)] hover:bg-[#93f7ae]"
                      : "border-[var(--a-line-2)] text-[var(--a-fg)] hover:bg-[#162019]"
                  )}
                >
                  {tier.cta} →
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-2">
            <div className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
              <div className="text-[10px] tracking-[0.12em] text-[var(--a-accent)]">▸ EARN</div>
              <div className="mt-2 text-lg font-semibold text-[var(--a-fg)]">免费赚积分</div>
              <div className="mt-4">
                {earnWays.map((item, index) => (
                  <div
                    key={item.label}
                    className={cn(
                      "flex items-center gap-3 py-3",
                      index > 0 ? "border-t border-[var(--a-line)]" : ""
                    )}
                  >
                    <span className="inline-flex size-6 items-center justify-center rounded bg-[rgba(124,242,156,0.08)] text-[13px] text-[var(--a-accent)]">
                      {item.icon}
                    </span>
                    <span className="flex-1 text-sm text-[var(--a-fg-dim)]">{item.label}</span>
                    <span className="text-sm font-medium text-[var(--a-accent)]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
              <div className="text-[10px] tracking-[0.12em] text-[var(--a-warn)]">▸ RECHARGE</div>
              <div className="mt-2 text-lg font-semibold text-[var(--a-fg)]">充值积分</div>
              <div className="mt-4">
                {rechargeTiers.map((item, index) => (
                  <div
                    key={item.amount}
                    className={cn(
                      "flex items-center gap-3 py-3",
                      index > 0 ? "border-t border-[var(--a-line)]" : ""
                    )}
                  >
                    <span className="w-16 text-base font-semibold text-[var(--a-fg)]">{item.amount}</span>
                    <span className="flex-1 text-sm text-[var(--a-fg-dim)]">→ {item.points}</span>
                    {item.extra ? (
                      <span className="rounded bg-[rgba(124,242,156,0.08)] px-2 py-1 text-[11px] tracking-[0.04em] text-[var(--a-accent)]">
                        {item.extra}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 xl:grid-cols-2">
            <a
              href={GITHUB_LINK}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 rounded-md border border-[var(--a-line-2)] bg-[var(--a-bg-2)] px-5 py-4 transition-colors hover:bg-[#111814]"
            >
              <span className="w-12 text-[10px] tracking-[0.1em] text-[var(--a-fg-mute)]">$ OSS</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--a-fg)]">开源版</div>
                <div className="mt-1 text-[12px] text-[var(--a-fg-dim)]">完整源码，自由 clone / fork，社区支持</div>
              </div>
              <span className="text-sm text-[var(--a-accent)]">→ GitHub</span>
            </a>
            <a
              href={CONSULT_LINK}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 rounded-md border border-[var(--a-line-2)] bg-[var(--a-bg-2)] px-5 py-4 transition-colors hover:bg-[#111814]"
            >
              <span className="w-12 text-[10px] tracking-[0.1em] text-[var(--a-fg-mute)]">$ ENT</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--a-fg)]">团队版</div>
                <div className="mt-1 text-[12px] text-[var(--a-fg-dim)]">私有化离线部署，企业级安全与审计，商业支持</div>
              </div>
              <span className="text-sm text-[var(--a-accent)]">→ 联系我们</span>
            </a>
          </div>
        </SectionShell>

        <SectionShell
          id="faq"
          index="06"
          label="FAQ"
          title="常见问题"
          subtitle="没有覆盖到的问题，可以直接进社区或者文档继续查。"
        >
          <div className="overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-panel)]">
            {faqItems.map((item, index) => (
              <div key={item.question} className={index < faqItems.length - 1 ? "border-b border-[var(--a-line)]" : ""}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                  className="flex w-full items-center gap-4 px-5 py-5 text-left text-sm text-[var(--a-fg)] transition-colors hover:bg-[rgba(124,242,156,0.03)]"
                >
                  <span className="w-4 text-[var(--a-accent)]">{openFaq === index ? "▾" : "▸"}</span>
                  <span className="flex-1">{item.question}</span>
                  <span className="text-[11px] tracking-[0.08em] text-[var(--a-fg-mute)]">Q{String(index + 1).padStart(2, "0")}</span>
                </button>
                {openFaq === index ? (
                  <div className="px-5 pb-5 pl-[52px] text-sm leading-7 text-[var(--a-fg-dim)]">{item.answer}</div>
                ) : null}
              </div>
            ))}
          </div>
        </SectionShell>

        <section className="mx-auto max-w-[1280px] px-5 pb-10 pt-6 text-center sm:px-8 sm:pb-14 sm:pt-10">
          <div className="pointer-events-none absolute left-1/2 h-[280px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(124,242,156,0.15),transparent_70%)] blur-3xl" />
          <div className="relative">
            <div className="text-[11px] tracking-[0.12em] text-[var(--a-accent)]">┌─ START WITH MONKEYCODE ─┐</div>
            <h2 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:text-[56px]">
              现在就开始，
              <br />
              <span className="text-[var(--a-accent)]">把想法真正做出来</span>
            </h2>
            <p className="mx-auto mt-4 max-w-[480px] text-sm leading-8 text-[var(--a-fg-dim)]">
              无需本地环境，无需复杂配置。打开浏览器，你就可以立刻开始第一个 AI 开发任务。
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <HeaderAction to={isLoggedIn ? "/console" : "/login"} primary>
                <IconArrowRight className="size-4" />
                <span>开始使用</span>
              </HeaderAction>
              <HeaderAction href={GITHUB_LINK} external>
                <Icon name="GitHub-Uncolor" className="size-4 fill-current" />
                <span>GitHub</span>
              </HeaderAction>
            </div>
          </div>
        </section>
      </main>

      <TerminalFooter />
    </div>
  );
}

function HeroTerminalCard() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-[-20px] bg-[radial-gradient(ellipse_at_center,rgba(124,242,156,0.12),transparent_70%)] blur-3xl" />
      <div className="relative overflow-hidden rounded-xl border border-[var(--a-line-2)] bg-[var(--a-panel)] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7),0_0_40px_rgba(124,242,156,0.04)]">
        <div className="flex items-center gap-3 border-b border-[var(--a-line)] bg-[var(--a-bg)] px-4 py-3">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f56]" />
            <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="size-2.5 rounded-full bg-[#27c93f]" />
          </div>
          <div className="text-[9px] text-[var(--a-fg-dim)] sm:text-[10px]">MonkeyCode · 开发一个网页版《我的世界》游戏</div>
          <div className="ml-auto flex items-center gap-2 text-[8.5px] text-[var(--a-accent)]">
            <span className="size-[5px] rounded-full bg-[var(--a-accent)] shadow-[0_0_5px_var(--a-accent)]" />
            LIVE
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_170px]">
          <div className="border-b border-[var(--a-line)] lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3 border-b border-[var(--a-line)] bg-[var(--a-bg-2)] px-3 py-2 text-[9px]">
              <span className="inline-flex items-center rounded-full border border-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.08)] px-2 py-0.5 leading-none text-[var(--a-accent)]">
                glm-5.1
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <span className="ml-auto inline-flex size-4 items-center justify-center text-[var(--a-warn)]">
                  <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden="true">
                    <circle cx="10" cy="10" r="6" fill="none" stroke="var(--a-line-2)" strokeWidth="2.2" />
                    <circle
                      cx="10"
                      cy="10"
                      r="6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 6}`}
                      strokeDashoffset={`${2 * Math.PI * 6 * (1 - heroContextUsage / 100)}`}
                      className="drop-shadow-[0_0_4px_rgba(124,242,156,0.45)]"
                    />
                  </svg>
                </span>
              </div>
              <span className="leading-none text-[var(--a-fg-dim)]">14.2k tokens</span>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div>
                <div className="text-[10px] leading-6 text-[var(--a-fg)]">计划分成 3 步：</div>
                <div className="mt-2 space-y-1 text-[9.5px] leading-6 text-[var(--a-fg-dim)]">
                  <div>
                    <span className="text-[var(--a-accent)]">1.</span> 先用 <span className="text-[var(--a-magenta)]">terrain.ts</span> 生成方块地形和基础光照
                  </div>
                  <div>
                    <span className="text-[var(--a-accent)]">2.</span> 在 <span className="text-[var(--a-magenta)]">chunk.ts</span> 里做区块加载、视野剔除和存档
                  </div>
                  <div>
                    <span className="text-[var(--a-accent)]">3.</span> 给 <span className="text-[var(--a-magenta)]">inventory.ts</span> 补背包、放置方块和快捷栏切换
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded border border-[rgba(124,242,156,0.16)] bg-[rgba(124,242,156,0.04)] px-3 py-2 text-[9px] leading-none text-[var(--a-fg-dim)]">
                  <IconFilePencil className="size-3 shrink-0 text-[var(--a-accent-dim)]" />
                  <span className="inline-flex items-center gap-1 leading-none">
                    <span>修改文件</span>
                    <span className="text-[var(--a-fg)]">chunk.ts</span>
                  </span>
                  <span className="ml-auto inline-flex items-center gap-2 text-[8.5px] leading-none">
                    <span className="text-[var(--a-accent)]">+126</span>
                    <span className="text-[var(--a-danger)]">-18</span>
                  </span>
                </div>
                <div className="mt-3 text-[9.5px] leading-6 text-[var(--a-fg-dim)]">
                  首个可玩版本我会先做平原地形、昼夜循环和第一人称拾取交互，保证移动、挖掘、放置这三条主链路能跑通。
                </div>
                <div className="mt-2 space-y-1 text-[9px] leading-5 text-[var(--a-fg-dim)]">
                  <div>• 地形用 seed 驱动，保证每次刷新都能复现同一张地图</div>
                  <div>• 方块交互走 raycast，鼠标左键挖掘，右键放置</div>
                  <div>• 先预留 biome 和 crafting 接口，后面再继续扩展</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex h-8 min-w-0 flex-1 items-center rounded-[6px] border border-[var(--a-line-2)] bg-[var(--a-panel)] px-3 text-[9px] leading-none text-[var(--a-fg-dim)] ring-1 ring-inset ring-[rgba(124,242,156,0.12)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <span className="truncate leading-none text-[var(--a-fg)]">继续把挖掘动画和合成台也接上</span>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-[4px] border border-[rgba(124,242,156,0.24)] bg-[rgba(124,242,156,0.1)] px-2.5 text-[8.5px] leading-none text-[var(--a-accent)]"
                >
                  <IconSend className="size-2.5" />
                  <span className="inline-flex items-center leading-none">发送</span>
                </button>
              </div>
            </div>
          </div>

          <div className="bg-[var(--a-bg-2)]">
            <div className="py-2">
              {heroFileTree.map((file) => (
                <div
                  key={`${file.name}-${file.indent ?? 0}`}
                  className={cn(
                    "group flex cursor-pointer items-center gap-1.5 border-l-2 px-3 py-1 text-[9.5px] transition-colors",
                    file.active
                      ? "border-[var(--a-accent)] bg-[rgba(124,242,156,0.06)] text-[var(--a-accent)]"
                      : "border-transparent text-[var(--a-fg-dim)] hover:bg-[rgba(124,242,156,0.04)] hover:text-[var(--a-fg)]"
                  )}
                  style={{ paddingLeft: 10 + (file.indent || 0) * 10 }}
                >
                  {file.type === "folder" ? (
                    file.open ? (
                      <IconFolderOpen className="size-3 shrink-0 text-[var(--a-fg-mute)] transition-colors group-hover:text-[var(--a-accent)]" />
                    ) : (
                      <IconFolder className="size-3 shrink-0 text-[var(--a-fg-mute)] transition-colors group-hover:text-[var(--a-accent)]" />
                    )
                  ) : (
                    <IconFile className="size-3 shrink-0 text-[var(--a-fg-mute)] transition-colors group-hover:text-[var(--a-accent)]" />
                  )}
                  <span className="flex-1 truncate">{file.name}</span>
                  {file.dot ? <span className="size-[5px] rounded-full" style={{ background: file.dot }} /> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--a-line-2)] bg-[var(--a-bg)] px-4 py-3 text-[9.5px] leading-[14px]">
          <PromptLine path="~/app" className="text-[9.5px] leading-[14px]">pnpm add three zustand</PromptLine>
          <div className="pl-1 leading-[14px] text-[var(--a-fg-dim)]">
            + three 0.181.1
            <br />+ zustand 5.1.0
            <br />
            <span className="text-[var(--a-accent)]">✓ 2 packages added in 1.2s</span>
          </div>
          <div>
            <PromptLine path="~/app" className="text-[9.5px] leading-[14px]">
              <BlinkCursor />
            </PromptLine>
          </div>
        </div>
      </div>
    </div>
  );
}
