import { AuthProvider } from "@/components/auth-provider"
import Footer from "@/components/welcome/footer"
import Header from "@/components/welcome/header"
import Pricing, { plans } from "@/components/welcome/pricing"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IconArrowRight, IconCheck, IconMinus, IconSparkles } from "@tabler/icons-react"
import { Link } from "react-router-dom"
import "@/styles/welcome-pixel.css";

const comparisonRows = [
  {
    feature: "适用对象",
    values: ["个人开发者", "深度使用的个人开发者", "协作团队", "私有化与合规场景"],
  },
  {
    feature: "模型选择",
    values: ["平台指定免费模型", "多种内置模型自主选择", "按团队策略统一管理", "可按内网环境定制"],
  },
  {
    feature: "任务并行",
    values: ["1 个任务", "多个任务并行", "支持团队协作分工", "按部署能力规划"],
  },
  {
    feature: "云开发环境",
    values: ["2 核 8GB", "2 核 8GB", "团队共享协作能力", "本地 / 内网自部署"],
  },
  {
    feature: "Git 机器人",
    values: ["支持", "支持", "支持", "支持"],
  },
  {
    feature: "团队管理",
    values: ["-", "-", "支持", "支持"],
  },
  {
    feature: "数据私有化",
    values: ["-", "-", "-", "支持"],
  },
]

const faqs = [
  {
    question: "基础版是否真的可以直接开始使用？",
    answer:
      "可以。个人用户注册后默认进入基础版，可直接体验云开发环境、智能任务和 Git 机器人等核心能力，用于上手和日常轻量研发。",
  },
  {
    question: "专业版的 10,000 积分 / 月如何理解？",
    answer:
      "专业版按积分兑换，核心价值是解锁多模型自选与多任务并行。页面保留月度参考值，实际使用时仍以平台内积分规则和说明为准。",
  },
  {
    question: "团队版适合什么团队？",
    answer:
      "适合希望把 AI 研发能力接入团队协作流程的团队。除了个人版能力外，还会增加团队协作开发和团队管理相关能力。",
  },
  {
    question: "离线版和在线版的区别是什么？",
    answer:
      "在线版由平台托管，适合快速上手；离线版面向本地或内网部署场景，更强调数据私有、安全与合规，适合对部署环境有要求的团队。",
  },
]

function PricingPageContent() {
  return (
    <main className="flex-1">
      <section className="px-6 pt-28 pb-10 sm:px-10 sm:pt-32 sm:pb-14">
        <div className="pixel-panel-dark mx-auto max-w-[1200px] overflow-hidden border-amber-300 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_30%),linear-gradient(135deg,#0f172a,#111827_58%,#1e293b)] px-6 py-10 text-slate-50 sm:px-10 sm:py-14">
          <Badge className="pixel-badge font-pixel rounded-none border-slate-50 bg-white/10 px-3 py-2 text-[10px] text-white hover:bg-white/10">
            <IconSparkles />
            MODEL PAGE
          </Badge>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-balance text-4xl font-bold leading-tight sm:text-5xl">
                从免费开始，按研发深度选择合适型号
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-300 sm:text-base">
                MonkeyCode 的型号围绕真实研发使用方式展开。先用基础版快速验证，再按模型选择、并行任务、团队协作和私有化需求逐步扩展。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="pixel-panel border-amber-200 bg-white/8 p-4">
                <div className="font-terminal text-3xl font-semibold">免费</div>
                <div className="mt-1 text-sm text-slate-300">基础版可直接开始</div>
              </div>
              <div className="pixel-panel border-amber-200 bg-white/8 p-4">
                <div className="font-terminal text-3xl font-semibold">多模型</div>
                <div className="mt-1 text-sm text-slate-300">专业版可自主选择</div>
              </div>
              <div className="pixel-panel border-amber-200 bg-white/8 p-4">
                <div className="font-terminal text-3xl font-semibold">私有化</div>
                <div className="mt-1 text-sm text-slate-300">离线版适配内网部署</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Pricing showIntro={false} pixelized />

      <section className="px-6 py-6 sm:px-10 sm:py-10">
        <div className="pixel-panel mx-auto max-w-[1200px] border-slate-900 bg-white p-6 sm:p-8">
          <div className="max-w-2xl">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-sky-100 px-3 py-2 text-[10px] text-slate-900">
                COMPARE
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">能力对比</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
              如果你只需要快速上手，基础版已经够用；如果你需要更高自由度、更强协作能力或私有化部署，可以看下面这张表。
            </p>
          </div>

          <div className="mt-8 overflow-hidden border-2 border-slate-900">
            <Table className="bg-white">
              <TableHeader className="bg-amber-50">
                <TableRow className="hover:bg-muted/30">
                  <TableHead className="px-4 py-4 font-pixel text-[10px] tracking-normal text-slate-700">能力项</TableHead>
                  {plans.map((plan) => (
                    <TableHead key={plan.name} className="px-4 py-4 text-left font-pixel text-[10px] tracking-normal text-slate-700">
                      {plan.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonRows.map((row) => (
                  <TableRow key={row.feature}>
                    <TableCell className="px-4 py-4 font-medium text-foreground">{row.feature}</TableCell>
                    {row.values.map((value, index) => (
                      <TableCell key={`${row.feature}-${index}`} className="px-4 py-4 whitespace-normal text-sm leading-7 text-muted-foreground">
                        {value === "支持" ? (
                          <span className="inline-flex items-center gap-2 text-foreground">
                            <IconCheck className="size-4 text-primary" />
                            支持
                          </span>
                        ) : value === "-" ? (
                          <span className="inline-flex items-center gap-2 text-muted-foreground">
                            <IconMinus className="size-4" />
                            不包含
                          </span>
                        ) : (
                          value
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <section className="px-6 py-6 sm:px-10 sm:py-10">
        <div className="mx-auto grid max-w-[1200px] gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="pixel-panel border-slate-900 bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_100%)] p-6 sm:p-8">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
                NEED HELP
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">选型建议</h2>
            <div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground sm:text-base">
              <p>
                如果你第一次使用 MonkeyCode，建议先从
                <span className="font-semibold text-foreground">基础版</span>
                开始，先确认产品工作流是否适合你的研发方式。
              </p>
              <p>
                如果你已经明确需要更高的模型自由度和并行效率，再升级到
                <span className="font-semibold text-foreground">专业版</span>。
              </p>
              <p>
                如果你关注协作管理、权限边界或本地部署，再看
                <span className="font-semibold text-foreground">团队版 / 离线版</span>。
              </p>
            </div>
          </div>

          <div className="pixel-panel border-slate-900 bg-white p-6 sm:p-8">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-emerald-100 px-3 py-2 text-[10px] text-slate-900">
                FAQ
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">常见问题</h2>
            <Accordion type="single" collapsible className="mt-6">
              {faqs.map((faq) => (
                <AccordionItem key={faq.question} value={faq.question} className="border-border/70">
                  <AccordionTrigger className="py-5 text-base text-foreground hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-7 text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      <section className="px-6 pt-6 pb-16 sm:px-10 sm:pt-10 sm:pb-20">
        <div className="pixel-panel pixel-grid mx-auto max-w-[1200px] border-slate-900 bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.16),transparent_34%),linear-gradient(180deg,#ffffff_0%,#fff7ed_100%)] px-6 py-10 text-center sm:px-10 sm:py-14">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            先用基础版开始，再决定是否升级
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            价格页面的目的不是让你马上买更贵的版本，而是让你更容易判断现在应该从哪一档开始。
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="pixel-button border-slate-900" asChild>
              <Link to="/console">
                立即开始
                <IconArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" className="pixel-button border-slate-900 bg-white text-slate-900 hover:bg-slate-50" asChild>
              <a href="https://baizhi.cloud/consult" target="_blank" rel="noreferrer">
                咨询团队方案
              </a>
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}

export default function PricingPage() {
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,#f8fafc_0%,#fff7ed_34%,#ffffff_65%)]">
        <Header />
        <PricingPageContent />
        <Footer />
      </div>
    </AuthProvider>
  )
}
