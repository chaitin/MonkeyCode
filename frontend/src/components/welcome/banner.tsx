import { Button } from "@/components/ui/button";
import {
  IconArrowRight,
  IconBrandGithub,
  IconCloudCode,
  IconCodeDots,
  IconSparkles,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";

const stats = [
  { value: "不限额", label: "免费使用" },
  { value: "云端", label: "自带开发环境" },
  { value: "开源", label: "支持私有化方向" },
];

const Banner = () => {
  return (
    <section className="w-full px-6 pt-32 pb-14 sm:px-10 sm:pt-36 sm:pb-20">
      <div className="mx-auto grid w-full max-w-[1200px] gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
        <div className="flex flex-col gap-7">
          <div className="pixel-badge font-pixel inline-flex w-fit items-center gap-2 border-slate-900 bg-amber-100 px-3 py-2 text-[10px] text-slate-900">
            <IconSparkles className="size-3.5" />
            LEVEL 01
          </div>

          <div className="flex flex-col gap-4">
            <h1 className="max-w-3xl text-balance text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              MonkeyCode 是
              <span className="block text-primary">在线 AI 编程平台</span>
            </h1>
            <p className="max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              支持不限额度免费使用，不需要连接本地开发机，也不需要先折腾复杂环境。你可以直接在平台里创建任务，让 AI 编码，在云端开发环境中使用终端、文件管理和预览，再把结果接回 Git 协作流程。
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="pixel-button h-12 border-slate-900 px-6" asChild>
              <Link to="/console/">
                免费立即开始
                <IconArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" className="pixel-button h-12 border-slate-900 bg-white px-6 text-slate-900 hover:bg-slate-50" asChild>
              <a href="https://github.com/chaitin/MonkeyCode" target="_blank" rel="noreferrer">
                <IconCodeDots className="size-4" />
                查看开源仓库
              </a>
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((item) => (
              <div
                key={item.label}
                className="pixel-panel border-slate-900 bg-white px-5 py-4"
              >
                <div className="font-terminal text-3xl leading-none text-slate-950">{item.value}</div>
                <div className="mt-2 text-sm text-slate-500">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            <div className="pixel-badge inline-flex items-center gap-2 border-slate-900 bg-white px-3 py-2">
              <IconCloudCode className="size-4 text-primary" />
              不限额度免费使用
            </div>
            <div className="pixel-badge inline-flex items-center gap-2 border-slate-900 bg-white px-3 py-2">
              <IconBrandGithub className="size-4 text-primary" />
              无需连接本地开发机
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -left-6 top-10 hidden h-28 w-28 border-2 border-primary/25 bg-primary/8 lg:block" />
          <div className="absolute right-2 bottom-6 hidden h-20 w-20 border-2 border-amber-300 bg-amber-100/70 lg:block" />

          <div className="pixel-panel pixel-grid border-slate-900 bg-[#fffdf8] p-3 sm:p-4">
            <div className="flex items-center justify-between border-2 border-slate-900 bg-slate-950 px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <img src="/logo-light.png" className="size-8 border border-white/15 bg-white p-1" alt="MonkeyCode Logo" />
                <div>
                  <div className="font-pixel text-[10px] text-amber-200">TASK RUNNING</div>
                  <div className="mt-2 text-xs text-slate-300">MonkeyCode Workspace</div>
                </div>
              </div>
              <div className="font-terminal text-2xl leading-none text-emerald-300">ONLINE</div>
            </div>

            <div className="mt-4 border-2 border-slate-900 bg-slate-950 p-2">
              <img
                src="/task-1.png"
                alt="MonkeyCode 任务执行界面"
                className="w-full border border-white/10 object-cover"
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="border-2 border-slate-900 bg-white px-4 py-4">
                <div className="font-pixel text-[10px] text-primary">INPUT</div>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  输入需求就能开始，支持不限额度免费使用，不需要先在自己电脑上准备环境、装工具或连接本地工程机。
                </p>
              </div>
              <div className="border-2 border-slate-900 bg-amber-50 px-4 py-4">
                <div className="font-pixel text-[10px] text-primary">OUTPUT</div>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  AI 编码、终端操作、文件修改和 Git 协作都回到同一个在线工作台，而不是散落在多个工具之间。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Banner;
