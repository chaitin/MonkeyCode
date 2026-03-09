import { IconBulbFilled } from "@tabler/icons-react";

const SDD = () => {

  const features = [
    { title: "规范即真理源", description: "先定义清楚「做什么」和「做对的标准」，再让 AI 动手「做」。规范驱动实现，代码成为规范的自然表达，消除意图与实现之间的鸿沟。" },
    { title: "标准化开发流程", description: "内置完整流程：需求定义 → 产品设计 → 技术规划 → 任务分解 → 代码实现，AI 深度参与每个阶段，支持专业级研发任务。" },
    { title: "多角色协作推进", description: "产品经理负责需求拆解，项目管理把控流程进度，研发工程师专注技术设计，AI 基于任务列表逐步执行开发。" },
    { title: "全程可控可追溯", description: "每个代码决策都能追溯到具体规范，问题定位快、责任归属清。告别 Vibe Coding 的随意性，实现大型项目的系统化管理。" },
  ];

  return (
    <div className="w-full px-10 py-24" id="sdd">
      <div className="w-full">
        <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">
          <h1 className="text-balance text-center text-4xl font-bold text-primary">
            SDD 规范驱动开发
          </h1>
          <p className="max-w-[800px] mx-auto leading-relaxed text-center">
            <span className="font-semibold">Specification-Driven Development</span> —— 相比 Vibe Coding 的随意性，MonkeyCode 更强调<span className="font-semibold">可控性、可追溯性与工程质量</span>。用形式化规范作为唯一真理源，驱动 AI 生成一致、可维护、可上线的代码。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-10">
            {features.map((feature, index) => (
              <div key={index} className="flex-1 border border-foreground/30 rounded-md p-4 flex flex-row gap-2 hover:border-primary">
                <IconBulbFilled className="size-8 flex-shrink-0 text-primary/30" />
                <div className="flex flex-col gap-2">
                  <div className="text-lg text-primary" >
                    {feature.title}
                  </div>
                  <div className="text-foreground/50" >
                    {feature.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
};

export default SDD;