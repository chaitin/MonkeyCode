import {
  IconGift,
  IconCloud,
  IconCpu,
  IconBrandOpenai,
} from "@tabler/icons-react";

const Highlights = () => {
  const items = [
    {
      icon: IconGift,
      title: "基础版免费",
      description: "注册即可使用云开发环境与大模型，零订阅门槛。",
    },
    {
      icon: IconCloud,
      title: "云开发环境",
      description: "内置云开发环境，开箱即用，无需本地配置。",
    },
    {
      icon: IconCpu,
      title: "2 核 8GB 云服务器",
      description: "每个开发任务对应一台独立云服务器，环境隔离、安全可控。",
    },
    {
      icon: IconBrandOpenai,
      title: "大模型能力",
      description:
        "基础版使用平台指定模型免费畅用；专业版可从多种内置模型中自主选择，并支持多任务并行。",
    },
  ];

  return (
    <div className="w-full px-6 sm:px-10 py-10 sm:py-12">
      <div className="w-full max-w-[1200px] mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 p-4 rounded-xl border bg-card/50 hover:bg-card hover:shadow-sm transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <item.icon className="size-4 text-primary" />
              </div>
              <h3 className="font-semibold text-base">{item.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Highlights;
