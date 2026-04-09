import { IconBolt, IconPlugConnectedX, IconRouteOff } from "@tabler/icons-react";

const items = [
  {
    icon: IconBolt,
    index: "01",
    title: "AI 会回答，但不真正推进交付",
    description:
      "很多工具停留在对话和补全层面，能给建议，却很难持续把一个需求推进成可运行、可审查、可提交的结果。",
  },
  {
    icon: IconPlugConnectedX,
    index: "02",
    title: "环境和流程经常断开",
    description:
      "本地环境、工具链、模型能力和仓库协作是分散的，研发工作很容易在不同工具之间来回切换，失去连续性。",
  },
  {
    icon: IconRouteOff,
    index: "03",
    title: "快速生成代码，不等于稳定交付",
    description:
      "Vibe Coding 适合试验灵感，但在真实项目里，缺少边界、规范和追踪链路，最终会把问题留给团队自己收拾。",
  },
];

const Highlights = () => {
  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
            WHY NOW
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            问题不在 AI 不够聪明，而在它还没真正进入研发流程
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            如果 AI 只能补全代码、回答问题，却无法进入环境、执行任务、接回 Git 协作，那它对真实研发的帮助就始终停留在边缘位置。
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
