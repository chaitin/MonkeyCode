import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Banner = () => {
  return (
    <div className="w-full px-6 sm:px-10 mt-48 sm:mt-56">
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-4">
        <h1 className="text-balance text-5xl font-bold tracking-tight leading-tight">
          MonkeyCode — 免费的 AI 编程平台
        </h1>
        <p className="text-base text-muted-foreground sm:text-lg leading-relaxed">
          说需求，AI 写代码、做设计、做 Review。云开发环境开箱即用，基础版免费起步，专业版支持多模型自选与多任务并行。
        </p>
        <div className="flex flex-row gap-4">
          <Button size="lg" asChild><Link to="/console/">开始使用</Link></Button>
          <Button size="lg" variant="secondary" asChild><a href="https://monkeycode.docs.baizhi.cloud/" target="_blank">上手指南</a></Button>
        </div>
      </div>
    </div>
  )
}

export default Banner;