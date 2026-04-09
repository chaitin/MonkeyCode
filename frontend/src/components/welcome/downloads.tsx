import {
  IconArrowUpRight,
  IconBrandApple,
  IconBrandAndroid,
  IconBrandWindows,
  IconDeviceMobile,
} from "@tabler/icons-react";

const RELEASE_URL = "https://github.com/chaitin/MonkeyCode/releases";

const clients = [
  {
    name: "Windows",
    description: "Windows 客户端",
    icon: IconBrandWindows,
  },
  {
    name: "macOS",
    description: "macOS 客户端",
    icon: IconBrandApple,
  },
  {
    name: "Android",
    description: "Android 客户端",
    icon: IconBrandAndroid,
  },
  {
    name: "iOS",
    description: "iPhone / iPad 客户端",
    icon: IconDeviceMobile,
  },
];

const Downloads = () => {
  return (
    <section className="w-full px-6 py-16 sm:px-10 md:py-24" id="downloads">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 rounded-[32px] border border-border/70 bg-primary px-6 py-10 text-background shadow-[0_24px_80px_rgba(249,115,22,0.2)] sm:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-background/70">
            Client Apps
          </p>
          <h2 className="text-balance text-2xl font-bold text-center md:text-4xl">
            全平台客户端
          </h2>
          <p className="mt-4 text-sm leading-7 text-background/75 sm:text-base">
            Web、桌面端和移动端统一接入同一套 AI 研发能力。需要切换设备时，不用重新适配工作流。
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6 md:mt-10">
          {clients.map((client) => (
            <a
              key={client.name}
              href={RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              className="group flex h-full flex-col justify-between rounded-2xl border border-background/20 bg-background/8 p-5 transition-all duration-200 hover:-translate-y-1 hover:border-background/40 hover:bg-background/12"
            >
              <div className="flex items-center gap-3">
                <div className="size-12 rounded-lg bg-background/10 text-background flex items-center justify-center shrink-0">
                  <client.icon className="size-7" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-none">{client.name}</h3>
                  <p className="text-sm text-background/70 mt-2 leading-relaxed">
                    {client.description}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-background/15 pt-3">
                <p className="text-sm font-medium text-background">
                  下载
                </p>
                <IconArrowUpRight className="size-4 text-background/60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Downloads;
