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
    <section className="w-full py-16 md:py-24 px-6 sm:px-10 bg-primary text-background" id="downloads">
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-balance text-2xl md:text-4xl font-bold text-center">
            全平台客户端
          </h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6 md:mt-10">
          {clients.map((client) => (
            <a
              key={client.name}
              href={RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              className="group flex h-full flex-col justify-between rounded-xl border border-background/20 bg-background/5 p-4 hover:border-background/40 hover:bg-background/10 hover:-translate-y-0.5 transition-all"
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
