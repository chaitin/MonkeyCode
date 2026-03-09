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

const Pricing = () => {
  const plans = [
    {
      name: "个人版",
      description: "适合个人开发者",
      price: "免费",
      priceUnit: "",
      features: [
        "智能任务模式",
        "在线 Git 机器人",
        "IDE 辅助插件"
      ],
      buttonText: "立即开始",
      buttonLink: "/console",
      buttonVariant: "default" as const,
      popular: true,
    },
    {
      name: "团队版",
      description: "适合中小型研发团队",
      price: "限时免费",
      priceUnit: "",
      features: [
        "智能任务模式",
        "在线 Git 机器人",
        "IDE 辅助插件",
        "团队配置管理",
        "团队数据统计",
      ],
      buttonText: "在线申请",
      buttonLink: "https://baizhi.cloud/consult",
      buttonVariant: "outline" as const,
      popular: false,
    },
    {
      name: "离线版",
      description: "本地部署，数据完全私有",
      price: "敬请期待",
      priceUnit: "",
      features: [
        "智能任务模式",
        "在线 Git 机器人",
        "IDE 辅助插件",
        "团队配置管理",
        "团队数据统计",
        "本地部署"
      ],
      buttonText: "提前预定",
      buttonLink: "https://baizhi.cloud/consult",
      buttonVariant: "outline" as const,
      popular: false,
    },
  ];

  return (
    <div className="w-full py-20 px-10" id="pricing">
      <div className="w-full max-w-[1200px] mx-auto">
        <h1 className="text-balance text-4xl font-bold tracking-tight mb-10 text-center">
          价格方案
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
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
                  <a href={plan.buttonLink} target="_blank">{plan.buttonText}</a>
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