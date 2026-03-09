import { useState } from "react";
import InputBox from "./inputbox";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { IconBulbFilled } from "@tabler/icons-react";

const Task = () => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const images = [
    { src: "task-1.png", title: "在线执行任务" },
    { src: "task-2.png", title: "使用 CLI Coding 工具" },
    { src: "task-3.png", title: "移动端操作" },
  ];

  const features = [
    { title: "工具无关性", description: "Code Agent 支持 OpenAI Codex、Claude Code、OpenCode 等，如果你已经熟悉了某种 Agent，可以无缝切换到 MonkeyCode 上。" },
    { title: "模型无关性", description: "兼容 GPT、Claude、Deepseek、GLM、Kimi、Qwen、Doubao 等大模型，或其他本地模型。" },
    { title: "多种任务模式", description: "开发模式根据需求执行编码任务，设计模式进行架构设计并输出技术方案，审查模式识别代码风险并提出改进建议。" },
    { title: "开发环境隔离", description: "允许用户将自己的开发机接入 MonkeyCode，任务启动时会创建一个全新的操作系统供当前任务使用。" },
  ];

  return (
    <div className="w-full px-10 py-24 bg-primary text-background" id="task">
      <div className="w-full">
        <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">
          <h1 className="text-balance text-center text-4xl font-bold mb-10">
            智能任务模式
          </h1>
          <div className="">
            <InputBox />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-10">
            {features.map((feature, index) => (
              <div key={index} className="flex-1 border border-background/30 rounded-md p-4 flex flex-row gap-2 hover:border-background">
                <IconBulbFilled className="size-8 text-background/40 flex-shrink-0" />
                <div className="flex flex-col gap-2">
                  <div className="text-lg" >
                    {feature.title}
                  </div>
                  <div className="text-background/50" >
                    {feature.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10">
            {images.map((image, index) => (
              <div
                key={index}
                className="bg-muted rounded-md overflow-hidden relative group cursor-pointer"
                onClick={() => setSelectedImage(image.src)}
              >
                <img src={image.src} className="w-full object-cover" alt={image.title} />
                <div className="absolute inset-0 bg-black opacity-60 group-hover:opacity-0 transition-opacity duration-500 items-center justify-center flex" >
                  {image.title}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Dialog open={selectedImage !== null} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-w-[90vw] md:max-w-[80vw] lg:max-w-[60vw] p-0 border-none">
          {selectedImage && (
            <img
              src={selectedImage}
              alt="放大图片"
              className="w-full h-full object-contain max-h-[90vh] rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
};

export default Task;