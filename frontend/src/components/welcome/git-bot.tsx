import { useState, useEffect } from "react";
import {
  IconHandStop,
  IconRobot,
  IconFlame,
  IconGift,
  IconRocket,
  IconAt,
  IconServer,
  IconGitPullRequest,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

const GitBot = () => {
  const typewriterText = "@monkeycode-ai 你好，请帮我 review 这个 PR";
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex <= typewriterText.length) {
        setDisplayedText(typewriterText.slice(0, currentIndex));
        currentIndex++;
      } else {
        // 重置动画，循环播放
        setTimeout(() => {
          setDisplayedText("");
          currentIndex = 0;
        }, 2000);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const advantages = [
    {
      icon: IconGift,
      title: "完全免费",
      description: "无需订阅费用，零成本即可享受 AI 工程师的智能代码服务，帮你节省开发环境和大模型费用。",
    },
    {
      icon: IconRocket,
      title: "开箱即用",
      description: "无需下载安装，无需复杂配置，只需在评论区 @monkeycode-ai 即可立即获得帮助。",
    },
    {
      icon: IconServer,
      title: "多平台支持",
      description: "全面支持 GitHub、GitLab、Gitea、Gitee 等主流 Git 仓库托管平台，无缝集成你的工作流。",
    },
    {
      icon: IconFlame,
      title: "能力强悍",
      description: "自动 Code Review 发现潜在问题，自动实现 Issue 编写代码并提交 PR，做你的全能 AI 工程师。",
    },
  ];

  const steps = [
    {
      icon: IconHandStop,
      step: "1",
      title: "呼唤 AI 工程师",
      description: "在任意代码仓库的 PR 或 Issue 评论区 @monkeycode-ai",
    },
    {
      icon: IconRobot,
      step: "2",
      title: "等待响应",
      description: "AI 工程师将在收到消息后的 30 秒内做出回应",
    },
    {
      icon: IconFlame,
      step: "3",
      title: "获得帮助",
      description: "无需配置，仅需描述需求，就能获得 AI 工程师的帮助",
    },
  ];

  return (
    <div className="w-full py-16 md:py-24 px-4 md:px-10 bg-primary text-background" id="git-bot">
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-6">
        {/* Header */}
        <h1 className="text-balance text-2xl md:text-4xl font-bold text-center">
          全自动 Git 机器人
        </h1>

        <div className="relative bg-white rounded-lg shadow-2xl w-full border border-[#d0d7de] overflow-hidden text-[#1f2328] my-6 md:my-10">

          <div className="px-3 md:px-6 py-3 md:py-4 border-b border-[#d0d7de]">
            <div className="flex items-start gap-2 mb-2">
              <h2 className="text-base md:text-xl font-normal text-[#1f2328]">
                feat: 新增用户登录态自动刷新机制
                <span className="text-[#656d76] font-light ml-2">#328</span>
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm">
              <span className="inline-flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1 rounded-full bg-green-700 text-white font-medium">
                <IconGitPullRequest className="size-4 md:size-5" />
                Open
              </span>
              <span className="text-foreground/50">
                <span className="text-foreground font-medium hover:underline cursor-pointer">xiaomakuaipao</span>
                <span className="hidden sm:inline">
                  {" "}wants to merge 3 commits into <span className="px-1.5 py-0.5 bg-[#ddf4ff] text-[#0969da] rounded-md font-mono text-xs">main</span> from <span className="px-1.5 py-0.5 bg-[#ddf4ff] text-[#0969da] rounded-md font-mono text-xs">feat/auto-refresh</span>
                </span>
              </span>
            </div>
          </div>

          {/* Timeline Container */}
          <div className="relative px-3 md:px-6 py-3 md:py-4">
            {/* Timeline vertical line - hidden on mobile */}
            <div className="absolute left-[32px] md:left-[44px] top-0 bottom-0 w-[2px] bg-[#d0d7de] hidden md:block" />

            {/* Issue Body Comment */}
            <div className="relative flex gap-2 md:gap-4 mb-4 md:mb-6">
              <Avatar className="size-8 md:size-10 ring-2 ring-white relative z-10 flex-shrink-0 hidden md:flex">
                <AvatarImage src="/head.jpg" />
                <AvatarFallback className="bg-[#f6f8fa] text-[#656d76]">FY</AvatarFallback>
              </Avatar>
              <div className="flex-1 rounded-md border border-[#d0d7de] overflow-hidden">
                <div className="flex items-center justify-between px-3 md:px-4 py-2 bg-[#f6f8fa] border-b border-[#d0d7de] text-xs md:text-sm">
                  <div className="flex items-center gap-1 md:gap-2 flex-wrap">
                    <Avatar className="size-5 md:hidden flex-shrink-0">
                      <AvatarImage src="/head.jpg" />
                      <AvatarFallback className="bg-[#f6f8fa] text-[#656d76] text-[10px]">FY</AvatarFallback>
                    </Avatar>
                    <span className="font-semibold text-[#1f2328] hover:underline cursor-pointer">xiaomakuaipao</span>
                    <span className="text-[#656d76]">commented 2 minutes ago</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs rounded-full border border-[#d0d7de] text-[#656d76]">Author</span>
                  </div>
                </div>
                <div className="px-3 md:px-4 py-2 md:py-3 bg-white text-[#1f2328] text-xs md:text-sm leading-relaxed space-y-2">
                  <p className="font-medium">✨ 变更内容</p>
                  <ul className="list-disc list-inside text-[#656d76] space-y-1">
                    <li>新增 TokenRefreshService 实现登录态自动刷新</li>
                    <li>修复 token 过期后页面白屏的问题</li>
                    <li>添加相关单元测试用例</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* New Comment Input */}
            <div className="relative flex gap-2 md:gap-4">
              <Avatar className="size-8 md:size-10 ring-2 ring-white relative z-10 flex-shrink-0 hidden md:flex">
                <AvatarImage src="/head.jpg" />
                <AvatarFallback className="bg-[#f6f8fa] text-[#656d76]">FY</AvatarFallback>
              </Avatar>
              <div className="flex-1 rounded-md border border-[#d0d7de] overflow-hidden">
                <div className="bg-white p-2 md:p-3">
                  <div className="min-h-[60px] md:min-h-[80px] rounded-md border border-[#d0d7de] bg-[#f6f8fa] p-2 md:p-3 text-xs md:text-sm text-[#1f2328]">
                    {displayedText}
                  </div>
                  <div className="flex items-center justify-between mt-2 md:mt-3">
                    <button className="px-3 md:px-4 py-1 md:py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs md:text-sm font-medium rounded-md transition-colors">
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>


        {/* Advantages */}
        <div className="mb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {advantages.map((advantage, index) => (
              <div
                key={index}
                className="flex gap-4 border border-background/20 rounded-xl p-5 hover:border-background transition-colors"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-background/10 flex items-center justify-center">
                  <advantage.icon className="size-6 text-background/80" />
                </div>
                <div>
                  <h3 className="text-lg font-medium mb-1">{advantage.title}</h3>
                  <p className="text-background/60 text-sm leading-relaxed">
                    {advantage.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How to Use */}
        <div>
          <h2 className="text-2xl font-semibold text-center mb-8">使用方法</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((step, index) => (
              <div
                key={index}
                className="relative border border-background/20 rounded-xl p-6 hover:border-background transition-colors text-center"
              >
                {/* Step Number */}
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-background text-primary flex items-center justify-center font-bold text-sm">
                  {step.step}
                </div>
                {/* Icon */}
                <div className="w-16 h-16 rounded-full bg-background/10 flex items-center justify-center mx-auto mt-2 mb-4">
                  <step.icon className="size-8 text-background/80" />
                </div>
                <h3 className="text-lg font-medium mb-2">{step.title}</h3>
                <p className="text-background/60 text-sm">{step.description}</p>
              </div>
            ))}
          </div>

          {/* Call to Action */}
          <div className="mt-12 text-center">
            <div className="inline-flex items-center gap-2 bg-background/10 hover:bg-background/20 transition-colors px-6 py-3 rounded-full cursor-pointer">
              <IconAt className="size-5" />
              <span className="font-medium">monkeycode-ai</span>
            </div>
            <p className="text-background/50 text-sm mt-3">
              在任意 PR 或 Issue 中 @ 我，即可开始使用
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitBot;
