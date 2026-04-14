import { AuthProvider } from "@/components/auth-provider"
import Footer from "@/components/welcome/footer"
import Header from "@/components/welcome/header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  IconArrowRight,
  IconBattery4,
  IconBolt,
  IconCalendarCheck,
  IconCoin,
  IconGift,
  IconMessageChatbot,
  IconReceipt2,
  IconRocket,
  IconUsersGroup,
} from "@tabler/icons-react"
import { Link } from "react-router-dom"
import "@/styles/welcome-pixel.css"

const useCases = [
  {
    title: "模型调用",
    description: "积分可直接用于大模型调用，是日常开发和问答协作中的核心消耗项。",
    icon: IconMessageChatbot,
  },
  {
    title: "云开发环境",
    description: "创建和使用开发环境时，相关资源消耗也会从积分中扣除。",
    icon: IconBolt,
  },
  {
    title: "套餐兑换",
    description: "积分还可以用于开通专业版或旗舰版，获得更高并发和更多每日积分。",
    icon: IconRocket,
  },
] as const

const earnChannels = [
  {
    title: "每日签到",
    description: "每天可签到 1 次，完成后获得 100 积分奖励。",
    highlight: "+100 / 天",
    icon: IconCalendarCheck,
  },
  {
    title: "邀请注册",
    description: "分享邀请链接，好友通过链接注册后，你可获得 5000 积分奖励。",
    highlight: "+5,000 / 人",
    icon: IconUsersGroup,
  },
  {
    title: "社区活动",
    description: "加入技术交流群，参与不定期社区活动与福利互动，有机会获得额外积分。",
    highlight: "不定期活动",
    icon: IconGift,
  },
  {
    title: "兑换码",
    description: "平台活动或运营发放的兑换码，可在账户页兑换成积分。",
    highlight: "活动发放",
    icon: IconReceipt2,
  },
  {
    title: "充值积分",
    description: "如果你需要更稳定的额度，可以直接充值积分，随充随用。",
    highlight: "长期可用",
    icon: IconCoin,
  },
  {
    title: "套餐每日赠送",
    description: "专业版每天赠送 2 千积分，旗舰版每天赠送 3 万积分，仅当日有效。",
    highlight: "2 千 / 3 万",
    icon: IconBattery4,
  },
] as const

const faqs = [
  {
    question: "长期积分和今日积分有什么区别？",
    answer:
      "长期积分会持续保留，可用于后续消耗；今日积分主要来自每日赠送，通常在凌晨自动清零，适合当天优先使用。",
  },
  {
    question: "积分主要会消耗在哪些地方？",
    answer:
      "目前主要用于模型调用、开发环境相关消耗，以及兑换专业版或旗舰版等平台能力。",
  },
  {
    question: "新用户一开始怎么更容易攒积分？",
    answer:
      "最直接的方式是先完成每日签到，再通过邀请注册和参与社区活动持续积累；如果使用频率更高，可以结合专业版或旗舰版的每日赠送。",
  },
] as const

function PointsPageContent() {
  return (
    <main className="flex-1">
      <section className="px-6 pt-28 pb-10 sm:px-10 sm:pt-32 sm:pb-14">
        <div className="pixel-panel-dark mx-auto max-w-[1200px] overflow-hidden border-amber-300 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.16),transparent_32%),linear-gradient(135deg,#0f172a,#172554_55%,#1e293b)] px-6 py-10 text-slate-50 sm:px-10 sm:py-14">
          <Badge className="pixel-badge font-pixel rounded-none border-slate-50 bg-white/10 px-3 py-2 text-[10px] text-white hover:bg-white/10">
            <IconGift />
            EARN POINTS
          </Badge>
          <div className="mt-6 grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-balance text-4xl font-bold leading-tight sm:text-5xl">
                把积分用在关键研发动作上，也把积分赚得更轻松
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-300 sm:text-base">
                这页会把 MonkeyCode 积分的作用、积分类型和主要获取渠道一次讲清楚，方便你更高效地规划使用节奏。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="pixel-panel border-amber-200 bg-white/8 p-4">
                <div className="font-terminal text-3xl font-semibold">100</div>
                <div className="mt-1 text-sm text-slate-300">每日签到奖励</div>
              </div>
              <div className="pixel-panel border-amber-200 bg-white/8 p-4">
                <div className="font-terminal text-3xl font-semibold">5,000</div>
                <div className="mt-1 text-sm text-slate-300">邀请注册奖励</div>
              </div>
              <div className="pixel-panel border-amber-200 bg-white/8 p-4">
                <div className="font-terminal text-3xl font-semibold">3 万</div>
                <div className="mt-1 text-sm text-slate-300">旗舰版每日赠送</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-6 sm:px-10 sm:py-10">
        <div className="mx-auto grid max-w-[1200px] gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="pixel-panel border-slate-900 bg-[linear-gradient(180deg,#fff7ed_0%,#ffffff_100%)] p-6 sm:p-8">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
                POINT TYPES
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">积分类型</h2>
            <div className="mt-6 grid gap-4">
              <div className="rounded-md border-2 border-slate-900 bg-white p-4">
                <div className="text-sm font-medium text-foreground">长期积分</div>
                <div className="mt-2 text-sm leading-7 text-muted-foreground">
                  更适合稳定积累和长期使用，不会因为跨天自动清零。
                </div>
              </div>
              <div className="rounded-md border-2 border-slate-900 bg-sky-50 p-4">
                <div className="text-sm font-medium text-foreground">今日积分</div>
                <div className="mt-2 text-sm leading-7 text-muted-foreground">
                  主要用于承接每日赠送额度，适合当天优先消耗，凌晨会自动清零。
                </div>
              </div>
            </div>
          </div>

          <div className="pixel-panel border-slate-900 bg-white p-6 sm:p-8">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-emerald-100 px-3 py-2 text-[10px] text-slate-900">
                WHY IT MATTERS
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">积分有什么用</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {useCases.map((item) => (
                <div key={item.title} className="rounded-md border-2 border-slate-900 bg-white p-4">
                  <item.icon className="size-5 text-primary" />
                  <div className="mt-4 text-base font-semibold text-foreground">{item.title}</div>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-6 sm:px-10 sm:py-10">
        <div className="pixel-panel mx-auto max-w-[1200px] border-slate-900 bg-white p-6 sm:p-8">
          <div className="max-w-2xl">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-sky-100 px-3 py-2 text-[10px] text-slate-900">
                CHANNELS
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">怎么获得积分</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
              如果你想低成本开始，先用签到、邀请和社区活动；如果你使用更高频，再结合兑换码、充值和套餐每日赠送。
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {earnChannels.map((item) => (
              <div key={item.title} className="rounded-md border-2 border-slate-900 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5">
                <div className="flex items-start justify-between gap-3">
                  <item.icon className="size-5 text-primary" />
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    {item.highlight}
                  </span>
                </div>
                <div className="mt-4 text-base font-semibold text-foreground">{item.title}</div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-6 sm:px-10 sm:py-10">
        <div className="mx-auto grid max-w-[1200px] gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="pixel-panel border-slate-900 bg-[linear-gradient(180deg,#ecfeff_0%,#ffffff_100%)] p-6 sm:p-8">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-cyan-100 px-3 py-2 text-[10px] text-slate-900">
                QUICK START
              </span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">推荐节奏</h2>
            <div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground sm:text-base">
              <p>
                如果你刚开始使用，建议先完成
                <span className="font-semibold text-foreground">每日签到</span>
                ，再把邀请链接发给同事或朋友，先把基础积分池建立起来。
              </p>
              <p>
                如果你已经进入高频研发阶段，可以把
                <span className="font-semibold text-foreground">专业版 / 旗舰版每日赠送</span>
                和日常消耗配合起来用，效率会更稳。
              </p>
              <p>
                如果你想蹲更多额外奖励，记得关注
                <span className="font-semibold text-foreground">技术交流群和社区活动</span>。
              </p>
            </div>
          </div>

          <div className="pixel-panel border-slate-900 bg-white p-6 sm:p-8">
            <div className="mb-4">
              <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-violet-100 px-3 py-2 text-[10px] text-slate-900">
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
        <div className="pixel-panel pixel-grid mx-auto max-w-[1200px] border-slate-900 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.14),transparent_34%),linear-gradient(180deg,#ffffff_0%,#ecfeff_100%)] px-6 py-10 text-center sm:px-10 sm:py-14">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            先把积分机制搞明白，再决定你的使用策略
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            低成本上手就先赚积分，高频开发就配合套餐和充值一起规划，整体会更从容。
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="pixel-button border-slate-900" asChild>
              <Link to="/login">
                立即开始
                <IconArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" className="pixel-button border-slate-900 bg-white text-slate-900 hover:bg-slate-50" asChild>
              <Link to="/pricing">
                查看型号
                <IconArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  )
}

export default function PointsPage() {
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,#f8fafc_0%,#fff7ed_34%,#ffffff_65%)]">
        <Header />
        <PointsPageContent />
        <Footer />
      </div>
    </AuthProvider>
  )
}
