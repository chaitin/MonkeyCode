import { useState } from "react";
import InputBox from "./inputbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { IconArrowRight, IconBinaryTree2, IconCloudCode, IconMessageChatbot, IconTerminal2 } from "@tabler/icons-react";

const steps = [
  {
    icon: IconMessageChatbot,
    index: "01",
    title: "输入需求",
    description: "用自然语言描述你要完成的任务，不需要先把命令和步骤组织得像脚本一样严谨。",
  },
  {
    icon: IconBinaryTree2,
    index: "02",
    title: "选择任务模式",
    description: "根据阶段选择开发、设计或审查，让 AI 先判断当前该做什么，而不是一上来直接生成代码。",
  },
  {
    icon: IconCloudCode,
    index: "03",
    title: "进入云开发环境",
    description: "任务在独立环境中执行，项目结构、命令运行、文件修改和状态反馈都在同一个工作台里进行。",
  },
  {
    icon: IconTerminal2,
    index: "04",
    title: "输出结果并继续协作",
    description: "拿到代码、方案或 Review 结果后，可以继续迭代，也可以把结果带回 Git 协作流程。",
  },
];

const images = [
  { src: "task-1.png", title: "在线执行任务" },
  { src: "task-2.png", title: "使用 CLI Coding 工具" },
  { src: "task-3.png", title: "移动端操作" },
];

const Task = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20" id="task">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-sky-100 px-3 py-2 text-[10px] text-slate-900">
            FLOW
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            把一句需求推进成可执行任务，而不是一次聊天
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            MonkeyCode 的重点不是“对话结束了”，而是“任务开始了”。需求、模式、环境和执行结果被放在一条连续链路里。
          </p>
        </div>

        <div className="pixel-panel border-slate-900 bg-white px-4 py-4 sm:px-6 sm:py-6">
          <InputBox />
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="pixel-panel flex h-full flex-col gap-4 border-slate-900 bg-white px-5 py-5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-pixel text-[10px] text-primary">STEP {step.index}</span>
                <div className="flex size-10 items-center justify-center border-2 border-slate-900 bg-primary/10 text-primary">
                  <step.icon className="size-5" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-slate-950">{step.title}</h3>
              <p className="text-sm leading-7 text-slate-600">{step.description}</p>
              {index < steps.length - 1 ? (
                <div className="mt-auto hidden items-center gap-2 pt-3 text-xs text-slate-400 lg:flex">
                  <span className="h-px flex-1 bg-slate-300" />
                  <IconArrowRight className="size-4" />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {images.map((image) => (
            <button
              key={image.title}
              type="button"
              className="pixel-panel group cursor-pointer overflow-hidden border-slate-900 bg-white text-left"
              onClick={() => setSelectedImage(image.src)}
            >
              <img
                src={image.src}
                className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
                alt={image.title}
              />
              <div className="flex items-center justify-between border-t-2 border-slate-900 bg-amber-50 px-4 py-3">
                <span className="font-medium text-slate-950">{image.title}</span>
                <span className="font-pixel text-[10px] text-slate-500">VIEW</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={selectedImage !== null} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-[90vw] border-2 border-slate-900 p-0 md:max-w-[80vw] lg:max-w-[60vw]">
          {selectedImage ? (
            <img
              src={selectedImage}
              alt="放大图片"
              className="max-h-[90vh] w-full rounded-none object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default Task;
