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

type Plan = {
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

const plans: Plan[] = [
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

const Pricing = () => {
  return (
    <div className="w-full py-20 px-10" id="pricing">
      <div className="w-full max-w-[1200px] mx-auto">
        <h1 className="text-balance text-4xl font-bold tracking-tight mb-3 text-center">
          版本与方案
        </h1>
        <p className="text-center text-muted-foreground text-sm sm:text-base max-w-2xl mx-auto mb-10">
          在线版在云端使用，分为个人与团队；离线版可本地部署。个人用户默认为基础版，可使用积分兑换专业版。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {plans.map((plan, index) => (
            <Card
              key={index}
              className={cn(
                "relative flex flex-col",
                plan.popular && "border-primary shadow-lg"
              )}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                    推荐
                  </span>
                </div>
              )}
              <CardHeader>
                {plan.eyebrow && (
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {plan.eyebrow}
                  </p>
                )}
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-6">
                  <div className="flex items-baseline gap-1 flex-wrap">
                    <span className="text-4xl font-bold">{plan.price}</span>
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
                  className="w-full"
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
    </div>
  );
};

export default Pricing;
