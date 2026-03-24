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
    { title: "云开发环境", description: "每个任务对应一台 2 核 8GB 云服务器，内置在线 IDE、终端、文件管理，开箱即用，无需本地配置。" },
    { title: "多模型不限量", description: "内置 GLM、MiniMax、Kimi、Deepseek 等大模型，不限额度，可无限畅用。也可接入自己的 API 模型。" },
    { title: "多种任务模式", description: "开发模式根据需求执行编码任务，设计模式进行架构设计并输出技术方案，审查模式识别代码风险并提出改进建议。" },
    { title: "全流程覆盖", description: "覆盖需求 → 设计 → 开发 → 代码审查全流程，用自然语言描述需求，AI 帮你写代码、做设计、做 Review。" },
  ];

  return (
    <div className="w-full px-6 sm:px-10 py-16 sm:py-20 bg-background" id="task">
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-8">
        <h1 className="text-balance text-center text-3xl sm:text-4xl font-bold">
          智能任务模式
        </h1>
        <div>
          <InputBox />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((feature, index) => (
            <div key={index} className="border rounded-lg p-4 flex gap-3 bg-card/40 hover:bg-card hover:shadow-sm transition-all">
              <IconBulbFilled className="size-6 text-primary/70 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium mb-1">{feature.title}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{feature.description}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
