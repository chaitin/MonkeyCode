import { AuthProvider } from "@/components/auth-provider"
import Footer from "@/components/welcome/footer"
import Header from "@/components/welcome/header"

const sections = [
  {
    id: "scope",
    title: "协议适用范围",
    content: [
      "本协议适用于您访问、注册、登录或使用 MonkeyCode 智能开发平台及其相关网站、控制台、工具和服务的全部行为。",
      "您在使用平台前，应仔细阅读并理解本协议内容。您开始使用平台，即视为已阅读并同意接受本协议约束。",
    ],
  },
  {
    id: "account",
    title: "账号注册与使用",
    items: [
      "您应提供真实、准确、完整的注册信息，并及时更新。",
      "您应妥善保管账号、密码及登录凭证，并对账号下的行为承担相应责任。",
      "未经平台书面许可，您不得出租、出借、转让或售卖账号。",
      "如发现账号异常、被盗用或存在安全风险，应及时通知平台。",
    ],
  },
  {
    id: "service",
    title: "服务内容与变更",
    items: [
      "平台提供 AI 开发、任务执行、项目协作、代码审查及相关辅助功能。",
      "平台有权根据业务发展、合规要求或产品升级调整服务内容、收费策略、功能路径或技术方案。",
      "平台会尽力保持服务连续稳定，但不对因维护、升级、网络波动或不可抗力造成的短时中断承担违约责任。",
    ],
  },
  {
    id: "rules",
    title: "使用规范",
    content: ["您在使用平台服务时，不得实施以下行为："],
    items: [
      "违反法律法规、监管要求或公序良俗。",
      "上传、传播、存储非法、侵权、恶意或有害内容。",
      "攻击、干扰、绕过或破坏平台系统、接口、安全机制或服务稳定性。",
      "利用平台从事未经授权的数据抓取、作弊刷量、恶意调用或其他不正当行为。",
      "侵犯他人的知识产权、商业秘密、个人信息或其他合法权益。",
    ],
  },
  {
    id: "content",
    title: "用户内容与知识产权",
    items: [
      "您对自行上传、提交、输入或发布的内容依法享有相应权利，并应确保其来源合法。",
      "为向您提供服务，您授权平台在必要范围内对相关内容进行存储、处理、传输与展示。",
      "平台及其相关标识、页面设计、代码、文档和服务能力的知识产权归平台或权利人所有。",
      "未经授权，任何人不得对平台内容进行复制、修改、反向工程、传播或商业化利用。",
    ],
  },
  {
    id: "fees",
    title: "费用与结算",
    content: [
      "如平台部分服务涉及付费，您应按照页面展示或双方约定的规则完成购买、充值、结算或续费。",
      "除法律法规另有规定或平台明确说明外，已支付费用通常不支持无理由退还。",
    ],
  },
  {
    id: "liability",
    title: "责任限制",
    items: [
      "平台将尽合理努力保障服务可用性与结果质量，但 AI 生成内容可能存在偏差、遗漏或不完全准确，您应自行判断与复核。",
      "对于因您违反本协议、提供不实信息、错误操作或第三方原因造成的损失，平台不承担责任。",
      "在法律允许范围内，平台对间接损失、预期利益损失、数据附带损失不承担责任。",
    ],
  },
  {
    id: "termination",
    title: "协议终止与违约处理",
    items: [
      "如您违反本协议或相关规则，平台有权视情节采取警示、限制功能、暂停服务、封禁账号等措施。",
      "您可依据平台提供的路径停止使用相关服务；账号注销后，平台将按规则处理相关数据。",
    ],
  },
  {
    id: "contact",
    title: "联系我们",
    content: [
      "若您对本协议有任何疑问、建议或投诉，可通过官方渠道与我们联系。",
    ],
  },
]

export default function UserAgreementPage() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(18,111,88,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(255,177,66,0.16),transparent_26%),linear-gradient(180deg,#f7f8f2_0%,#fcfbf6_48%,#eef1e8_100%)]">
        <Header />
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-24 pb-12 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[32px] border border-white/40 bg-[linear-gradient(135deg,rgba(28,52,40,0.95),rgba(43,118,92,0.92))] p-8 text-white shadow-[0_24px_80px_rgba(35,62,49,0.16)] sm:p-10">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm">
              <img src="/logo.png" alt="MonkeyCode Logo" className="size-6" />
              <span>MonkeyCode 智能开发平台</span>
            </div>
            <h1 className="mt-6 text-4xl font-bold leading-tight sm:text-5xl">用户协议</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80 sm:text-[15px]">
              本协议用于说明您在使用 MonkeyCode 智能开发平台及相关服务时应遵守的规则，以及平台与您之间的权利义务关系。请在使用前认真阅读。
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-xs text-white/85 sm:text-sm">
              <span className="rounded-full bg-white/10 px-4 py-2">适用于官网与控制台服务</span>
              <span className="rounded-full bg-white/10 px-4 py-2">最近更新：2026-03-24</span>
              <span className="rounded-full bg-white/10 px-4 py-2">使用服务即视为同意本协议</span>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="h-fit rounded-[28px] border border-slate-900/10 bg-white/85 p-6 shadow-[0_24px_80px_rgba(35,62,49,0.14)] backdrop-blur lg:sticky lg:top-6">
              <h2 className="text-lg font-semibold text-slate-900">目录</h2>
              <nav className="mt-4 flex flex-col gap-1 text-sm">
                {sections.map((section, index) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="rounded-xl px-3 py-2 text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    {index + 1}. {section.title}
                  </a>
                ))}
              </nav>
            </aside>

            <article className="rounded-[28px] border border-slate-900/10 bg-white/85 p-7 shadow-[0_24px_80px_rgba(35,62,49,0.14)] backdrop-blur sm:p-8">
              {sections.map((section, index) => (
                <section
                  id={section.id}
                  key={section.id}
                  className={index === 0 ? "" : "mt-8 border-t border-slate-900/10 pt-8"}
                >
                  <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold tracking-[0.04em] text-emerald-700">
                    Section {index + 1}
                  </span>
                  <h2 className="mt-4 text-2xl font-semibold text-slate-900">{section.title}</h2>
                  {section.content?.map((paragraph) => (
                    <p key={paragraph} className="mt-3 text-[15px] leading-7 text-slate-500">
                      {paragraph}
                    </p>
                  ))}
                  {section.items ? (
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-7 text-slate-500">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  {section.id === "contact" ? (
                    <p className="mt-4 text-[15px] leading-7 text-slate-500">
                      官方渠道：
                      <a className="text-emerald-700 hover:underline" href="https://www.chaitin.cn/" target="_blank" rel="noreferrer">
                        长亭科技官网
                      </a>
                      {' '}或{' '}
                      <a className="text-emerald-700 hover:underline" href="https://www.baizhi.cloud/" target="_blank" rel="noreferrer">
                        长亭百智云官网
                      </a>
                      。
                    </p>
                  ) : null}
                </section>
              ))}
            </article>
          </section>
        </main>
        <Footer />
      </div>
    </AuthProvider>
  )
}
