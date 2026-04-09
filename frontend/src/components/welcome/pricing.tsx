import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Plan = {
  eyebrow?: string;
  name: string;
  description: string;
  price: string;
  priceUnit?: string;
  features: string[];
  buttonText: string;
  buttonLink: string;
  buttonVariant: "default" | "outline";
  popular?: boolean;
  external?: boolean;
};

export const plans: Plan[] = [
  {
    eyebrow: "在线版 · 个人",
    name: "基础版",
    description: "注册即可使用，云开发环境与大模型在平台规则内免费使用。",
    price: "免费",
    features: [
      "使用平台指定的免费模型",
      "同时仅可并行 1 个任务",
      "云开发环境（2 核 8GB）",
      "智能任务 + Git 机器人",
    ],
    buttonText: "立即开始",
    buttonLink: "/console",
    buttonVariant: "default",
    popular: true,
  },
  {
    eyebrow: "在线版 · 个人",
    name: "专业版",
    description: "使用积分兑换，解锁多模型自选与多任务并行。",
    price: "10,000",
    priceUnit: "积分 / 月",
    features: [
      "可从多种内置模型中自主选择",
      "支持多个任务并行执行",
      "含基础版全部能力",
      "积分来源：注册赠送 5,000、每邀请新用户 5,000、支持充值",
    ],
    buttonText: "立即开始",
    buttonLink: "/console",
    buttonVariant: "outline",
  },
  {
    eyebrow: "在线版 · 团队",
    name: "团队版",
    description: "在个人版能力基础上，提供团队协作与团队管理。",
    price: "限时免费",
    features: [
      "团队协作开发",
      "团队管理面板",
      "智能任务、Git 机器人、IDE 辅助等个人版能力",
    ],
    buttonText: "在线申请",
    buttonLink: "https://baizhi.cloud/consult",
    buttonVariant: "outline",
    external: true,
  },
  {
    eyebrow: "离线部署",
    name: "离线版",
    description: "由开源版本打包，支持本地离线部署，数据完全私有。",
    price: "敬请期待",
    features: [
      "GitHub 开源，可自行克隆部署（见下方仓库链接）",
      "本地或内网部署",
      "核心研发能力离线可用",
      "适合安全与合规要求高的场景",
    ],
    buttonText: "开源仓库",
    buttonLink: "https://github.com/chaitin/MonkeyCode",
    buttonVariant: "default",
    external: true,
  },
];

type PricingProps = {
  showIntro?: boolean;
  pixelized?: boolean;
};

const Pricing = ({ showIntro = true, pixelized = false }: PricingProps) => {
  return (
    <section className="w-full px-6 py-16 sm:px-10 sm:py-20" id="pricing">
      <div className="w-full max-w-[1200px] mx-auto">
        {showIntro ? (
          <>
            {pixelized ? (
              <div className="mb-4 text-center">
                <span className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
                  MODEL LIST
                </span>
              </div>
            ) : (
              <p className="mb-3 text-center text-sm font-medium uppercase tracking-[0.2em] text-primary/70">
                Pricing
              </p>
            )}
            <h2 className="text-balance text-4xl font-bold tracking-tight mb-3 text-center">
              {pixelized ? "型号一览" : "版本与方案"}
            </h2>
            <p className="text-center text-muted-foreground text-sm sm:text-base max-w-2xl mx-auto mb-10">
              在线版在云端使用，分为个人与团队；离线版可本地部署。个人用户默认为基础版，可使用积分兑换专业版。
            </p>
          </>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {plans.map((plan, index) => (
            <Card
              key={index}
              className={cn(
                "relative flex flex-col border-border/70 bg-white/85 shadow-sm shadow-black/5",
                pixelized && "pixel-panel rounded-none border-slate-900 bg-white shadow-[6px_6px_0_rgba(15,23,42,0.12)]",
                plan.popular && (pixelized ? "border-primary bg-amber-50" : "border-primary shadow-xl shadow-primary/10")
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className={cn(
                    "bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full",
                    pixelized && "font-pixel rounded-none border-2 border-slate-900 px-3 py-2 text-[10px]"
                  )}>
                    推荐
                  </span>
                </div>
              )}
              <CardHeader>
                {plan.eyebrow && (
                  <p className={cn("text-xs font-medium text-muted-foreground mb-1", pixelized && "font-pixel text-[10px] tracking-normal text-slate-500")}>
                    {plan.eyebrow}
                  </p>
                )}
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-6">
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className={cn("text-4xl font-bold", pixelized && "font-terminal text-5xl")}>{plan.price}</span>
                    {plan.priceUnit && (
                      <span className="text-muted-foreground text-sm">
                        {plan.priceUnit}
                      </span>
                    )}
                  </div>
                </div>
                <ul className="space-y-3">
                  {plan.features.map((feature, featureIndex) => (
                    <li key={featureIndex} className="flex items-start gap-2">
                      <svg
                        className="w-5 h-5 text-primary mt-0.5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-sm text-muted-foreground">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  variant={plan.buttonVariant}
                  className={cn("w-full", pixelized && "pixel-button border-slate-900")}
                  size="lg"
                  asChild
                >
                  <a
                    href={plan.buttonLink}
                    {...(plan.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {plan.buttonText}
                  </a>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Pricing;
