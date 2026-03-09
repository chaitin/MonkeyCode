import { Button } from "@/components/ui/button";

const Banner = () => {
  return (
    <div className="w-full px-10 mt-60">
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">
        <h1 className="text-balance text-5xl font-bold tracking-tight leading-tight">
          MonkeyCode 智能开发平台
        </h1>
        <p className="text-pretty text-base text-muted-foreground sm:text-lg">
          MonkeyCode 不是 AI 编程工具，是对传统研发模式的变革，是全新的 AI 编程体验，让你的研发团队效率 Max。
        </p>
        <div className="flex flex-row gap-4">
          <Button size="lg" asChild><a href="/console/">开始使用</a></Button>
          <Button size="lg" variant="secondary" asChild><a href="https://monkeycode.docs.baizhi.cloud/" target="_blank">上手指南</a></Button>
        </div>
      </div>
    </div>
  )
}

export default Banner;