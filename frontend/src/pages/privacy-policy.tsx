import { AuthProvider } from "@/components/auth-provider";
import LegalTerminalPage, { type LegalSection } from "@/components/welcome/legal-terminal-page";

const sections: LegalSection[] = [
  {
    id: "collection",
    title: "我们可能收集的信息",
    content: [
      "为提供账号注册、登录认证、任务协作、项目管理、支付结算、消息通知和客户支持等服务，我们可能收集与您相关的必要信息。",
    ],
    items: [
      "账号信息：如昵称、邮箱地址、头像、团队归属、登录状态等。",
      "身份认证信息：如密码摘要、绑定的第三方身份信息、验证码校验结果等。",
      "使用信息：如访问时间、操作日志、设备信息、浏览器信息、IP 地址、错误日志等。",
      "业务数据：如项目、任务、仓库连接信息、模型选择、配置项以及您主动提交的内容。",
      "客服与反馈信息：如您在工单、邮件、社群或反馈表单中提交的信息。",
    ],
  },
  {
    id: "usage",
    title: "我们如何使用这些信息",
    items: [
      "用于创建、维护和验证您的平台账号与团队身份。",
      "用于提供 AI 开发、任务执行、协作管理、通知提醒等核心功能。",
      "用于保障服务稳定性与安全性，包括风险识别、故障排查、审计追踪和异常处理。",
      "用于改进产品体验，如统计分析、性能优化、功能迭代与服务质量提升。",
      "在符合法律法规要求的前提下，用于履行合规义务或回应监管要求。",
    ],
    note: "我们仅在实现上述目的所必需的范围内处理个人信息，并尽量采用去标识化、权限隔离和最小化访问策略来降低风险。",
  },
  {
    id: "sharing",
    title: "信息共享、转让与公开披露",
    content: [
      "除法律法规另有规定，或为实现服务所必需外，我们不会向无关第三方出售您的个人信息。",
    ],
    items: [
      "经您授权或主动选择后，与第三方平台或服务提供方进行必要的数据交互。",
      "为完成支付、邮件发送、云资源调度、身份认证等基础能力，由受托服务商提供支持。",
      "在法律法规、司法机关或监管机构依法要求下进行披露。",
    ],
  },
  {
    id: "storage",
    title: "信息存储与安全保护",
    items: [
      "我们会采取访问控制、传输加密、日志审计、备份恢复等合理安全措施保护数据。",
      "您的信息会在实现业务目的所需的最短期限内保存，超期后将按规则删除或匿名化处理。",
      "如发生安全事件，我们会根据法律法规要求及时评估影响并采取补救措施。",
    ],
  },
  {
    id: "rights",
    title: "您享有的权利",
    content: ["在法律法规允许的范围内，您可以通过平台功能或联系我们行使以下权利："],
    items: [
      "查询、访问和更正您的账号资料。",
      "绑定、修改或删除部分账号信息与身份信息。",
      "注销账号，或在符合法律规定的情况下申请删除相关个人信息。",
      "对我们的信息处理规则提出意见、解释请求或投诉建议。",
    ],
  },
  {
    id: "cookies",
    title: "Cookies、会话与日志信息",
    content: [
      "为维持登录状态、提升访问效率并分析服务运行情况，我们可能使用 Cookies、本地存储、会话标识符以及服务日志。您可通过浏览器设置进行控制，但部分功能可能因此无法正常使用。",
    ],
  },
  {
    id: "children",
    title: "未成年人保护",
    content: [
      "本平台主要面向具备相应民事行为能力的用户和企业研发团队。若您为未成年人，请在监护人陪同下阅读并决定是否使用相关服务。",
    ],
  },
  {
    id: "updates",
    title: "政策更新",
    content: [
      "我们可能根据业务变化、产品升级或法律法规要求适时修订本隐私政策。更新后的版本会发布在本页面，并自发布之日起生效。若变更涉及您的重大权益，我们会通过合理方式向您提示。",
    ],
  },
  {
    id: "contact",
    title: "联系我们",
    content: [
      "如您对本隐私政策或个人信息处理事项有任何疑问、意见或投诉建议，可通过官方渠道与我们联系。",
    ],
    footer: (
      <>
        官方渠道：
        <a className="text-[var(--a-accent)] hover:underline" href="https://www.chaitin.cn/" target="_blank" rel="noreferrer">
          长亭科技官网
        </a>
        {" "}或{" "}
        <a className="text-[var(--a-accent)] hover:underline" href="https://www.baizhi.cloud/" target="_blank" rel="noreferrer">
          长亭百智云官网
        </a>
        。
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <AuthProvider>
      <LegalTerminalPage
        eyebrow="PRIVACY POLICY"
        title="隐私政策"
        subtitle="我们重视您的个人信息与数据安全。本页面用于说明 MonkeyCode 在提供产品与服务过程中，如何收集、使用、存储、共享和保护与您相关的信息，以及您可以如何管理这些信息。"
        lastUpdated="2026-03-24"
        tags={["适用于官网与控制台服务", "建议定期查看更新内容"]}
        sections={sections}
      />
    </AuthProvider>
  );
}
