import { IconBrandGithub, IconCloudCode, IconListDetails } from "@tabler/icons-react";

const modules = [
  {
    icon: IconListDetails,
    code: "MOD-01",
    title: "在线 AI 编程平台",
    description:
      "MonkeyCode 的核心不是一个聊天框，也不是本地插件，而是一个支持不限额度免费使用、可以直接创建任务并持续推进的在线 AI 编程入口。",
  },
  {
    icon: IconCloudCode,
    code: "MOD-02",
    title: "云开发环境直接可用",
    description:
      "任务在平台提供的开发环境中运行，终端、文件和预览能力都已经准备好，用户不需要依赖自己的本地开发机。",
  },
  {
    icon: IconBrandGithub,
    code: "MOD-03",
    title: "开源透明，可走私有化方向",
    description:
      "既可以在线快速开始，也保留开源仓库和离线部署方向。对开发者来说，这比单纯宣传模型能力更容易建立信任。",
  },
];

const SDD = () => {
  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20" id="sdd">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-slate-900 px-3 py-2 text-[10px] text-slate-50">
            CORE VALUE
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            三个关键词，概括 MonkeyCode 最值得宣传的点
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            首页不需要堆太多概念。把“它是什么”“为什么容易开始”“为什么值得信任”讲清楚，转化会比空泛口号更有效。
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {modules.map((module) => (
            <div
              key={module.code}
              className="pixel-panel-dark flex h-full flex-col gap-4 border-amber-300 bg-slate-950 px-6 py-6 text-white"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex size-11 items-center justify-center border-2 border-amber-300 bg-white/8 text-amber-200">
                  <module.icon className="size-5" />
                </div>
                <span className="font-pixel text-[10px] text-amber-200">{module.code}</span>
              </div>
              <h3 className="text-xl font-semibold tracking-tight">{module.title}</h3>
              <p className="text-sm leading-7 text-slate-300">{module.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
};

export default SDD;
