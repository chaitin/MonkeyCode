import { IconBrandGithub, IconCloudCode, IconListDetails } from "@tabler/icons-react";

const modules = [
  {
    icon: IconCloudCode,
    code: "MOD-01",
    title: "独立云开发环境",
    description:
      "任务直接在云端执行，不要求用户先把本地环境、模型配置和运行链路都准备好，减少真正开始前的阻力。",
  },
  {
    icon: IconListDetails,
    code: "MOD-02",
    title: "规范驱动开发",
    description:
      "先讲清楚做什么、做到什么程度、验收标准是什么，再让 AI 在边界内推进，避免只追求一时快感的随意生成。",
  },
  {
    icon: IconBrandGithub,
    code: "MOD-03",
    title: "回到真实协作流",
    description:
      "从任务执行到 Review，再到 PR 和 Issue 协作，MonkeyCode 不把结果困在聊天框里，而是继续推进到团队工作流中。",
  },
];

const SDD = () => {
  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20" id="sdd">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-slate-900 px-3 py-2 text-[10px] text-slate-50">
            CORE MODULES
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            三件事，把 MonkeyCode 和普通 AI coding 工具区分开
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            真正决定研发体验的，不是功能点数量，而是任务能否在稳定环境中执行、是否有明确规范边界，以及结果能否接回协作流。
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
