import { IconBolt, IconCloudCode, IconPlugConnectedX } from "@tabler/icons-react";

const items = [
  {
    icon: IconBolt,
    index: "01",
    title: "不限额度免费使用，先上手再判断",
    description:
      "这是首页最该被看见的卖点之一。用户可以先用真实任务验证 MonkeyCode 是否适合自己，而不是一开始就被额度和试用门槛卡住。",
  },
  {
    icon: IconCloudCode,
    index: "02",
    title: "自带云开发环境，打开就能干活",
    description:
      "终端、文件管理、端口预览和任务执行都在平台里，用户不需要先把本地环境、模型配置和运行链路拼起来。",
  },
  {
    icon: IconPlugConnectedX,
    index: "03",
    title: "不连接本地开发机，也能在线完成开发",
    description:
      "MonkeyCode 更像一个随时可用的在线开发入口。无论是临时验证、远程协作还是快速演示，都不用先占用自己的本地机器。",
  },
];

const Highlights = () => {
  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
            WHY MONKEYCODE
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            先把上手门槛降下来，再让 AI 真正参与编程
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            对开发者来说，很多 AI 工具真正卡住的不是不会生成代码，而是开始前还要先买额度、准备环境、接本地机器、切换一堆工具。MonkeyCode 把这些前置成本尽量收进平台里。
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="pixel-panel pixel-grid flex h-full flex-col gap-4 border-slate-900 bg-white px-6 py-6 transition-transform duration-200 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex size-11 items-center justify-center border-2 border-slate-900 bg-primary/12 text-primary">
                  <item.icon className="size-5" />
                </div>
                <span className="font-pixel text-[10px] text-slate-500">ERR-{item.index}</span>
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-slate-950">{item.title}</h3>
              <p className="text-sm leading-7 text-slate-600">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Highlights;
