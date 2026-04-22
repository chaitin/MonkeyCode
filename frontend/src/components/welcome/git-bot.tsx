import { useEffect, useState } from "react";
import {
  IconBrandGithub,
  IconCloudLock,
  IconGitPullRequest,
  IconShare2,
  IconShieldLock,
  IconStack2,
} from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";

const proofs = [
  {
    icon: IconBrandGithub,
    title: "开源仓库可见",
    description: "不是只给一张落地页和几句口号，用户可以直接查看仓库、版本和公开能力信息。",
  },
  {
    icon: IconStack2,
    title: "支持主流 Git 平台",
    description: "GitHub、GitLab、Gitea、Gitee 等协作链路都可以接入，不让 AI 结果停留在平台内部。",
  },
  {
    icon: IconShare2,
    title: "支持在线远程协作",
    description: "终端共享和远程协助能力让在线开发不只是自己用，也能服务演示、排障和团队协作场景。",
  },
  {
    icon: IconShieldLock,
    title: "可走私有化部署方向",
    description: "如果团队更看重数据边界和内网部署，MonkeyCode 也保留了离线版与私有化落地路径。",
  },
];

const platformTags = ["GitHub", "GitLab", "Gitea", "Gitee", "远程协助", "离线部署"];

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
        setDisplayedText(typewriterText);
      }
    }, 70);

    return () => clearInterval(interval);
  }, []);

  return (
    <section className="w-full px-6 py-14 sm:px-10 sm:py-20" id="git-bot">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="pixel-badge font-pixel inline-flex items-center border-slate-900 bg-emerald-100 px-3 py-2 text-[10px] text-slate-900">
            TRUST & COLLAB
          </div>
          <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            不只是在网页上在线写代码，还能接回真实协作
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            MonkeyCode 的价值不只是“在线生成代码”，还包括 Git Review、开源透明度、远程协作和私有化路径。这些才是开发者会长期关心的部分。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="pixel-panel overflow-hidden border-slate-900 bg-white">
            <div className="flex items-center justify-between border-b-2 border-slate-900 bg-slate-950 px-4 py-3 text-white">
              <div className="flex items-center gap-3">
                <span className="font-pixel text-[10px] text-amber-200">REVIEW STREAM</span>
                <span className="hidden text-xs text-slate-300 sm:inline">让 AI 回到真实 PR 协作流</span>
              </div>
              <div className="inline-flex items-center gap-2 border-2 border-emerald-300 bg-emerald-400 px-3 py-1 text-[10px] font-pixel text-slate-950">
                LIVE
              </div>
            </div>

            <div className="relative bg-white text-[#1f2328]">
              <div className="px-4 py-4 border-b border-[#d0d7de] sm:px-6">
                <div className="mb-2 flex items-start gap-2">
                  <h3 className="text-base font-medium sm:text-xl">
                    feat: 新增用户登录态自动刷新机制
                    <span className="ml-2 font-light text-[#656d76]">#328</span>
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-none border-2 border-green-900 bg-green-700 px-2 py-1 font-medium text-white">
                    <IconGitPullRequest className="size-4" />
                    Open
                  </span>
                  <span className="text-[#656d76]">
                    xiaomakuaipao wants to merge 3 commits into main from feat/auto-refresh
                  </span>
                </div>
              </div>

              <div className="space-y-4 px-4 py-4 sm:px-6">
                <div className="flex gap-3">
                  <Avatar className="mt-1 hidden size-9 shrink-0 border border-[#d0d7de] sm:flex">
                    <AvatarImage src="/head.jpg" />
                    <AvatarFallback>FY</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden border border-[#d0d7de]">
                    <div className="flex items-center justify-between border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-2 text-xs text-[#656d76] sm:text-sm">
                      <span>
                        <span className="font-semibold text-[#1f2328]">xiaomakuaipao</span>
                        {" "}commented 2 minutes ago
                      </span>
                      <span className="border border-[#d0d7de] px-2 py-0.5 text-[10px] sm:text-xs">Author</span>
                    </div>
                    <div className="space-y-2 px-4 py-3 text-sm leading-7 text-[#656d76]">
                      <p className="font-medium text-[#1f2328]">变更内容</p>
                      <ul className="list-disc space-y-1 pl-5">
                        <li>新增 TokenRefreshService 实现登录态自动刷新</li>
                        <li>修复 token 过期后页面白屏的问题</li>
                        <li>添加相关单元测试用例</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Avatar className="mt-1 hidden size-9 shrink-0 border border-[#d0d7de] sm:flex">
                    <AvatarImage src="/logo-light.png" />
                    <AvatarFallback>MC</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden border-2 border-slate-900 bg-amber-50">
                    <div className="border-b-2 border-slate-900 bg-amber-100 px-4 py-2">
                      <span className="font-pixel text-[10px] text-slate-700">BOT REVIEW</span>
                    </div>
                    <div className="px-4 py-4">
                      <div className="font-terminal min-h-[78px] text-2xl leading-7 text-slate-900">
                        {displayedText}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {proofs.map((proof) => (
                <div key={proof.title} className="pixel-panel flex h-full flex-col gap-4 border-slate-900 bg-white px-5 py-5">
                  <div className="flex size-10 items-center justify-center border-2 border-slate-900 bg-emerald-100 text-emerald-700">
                    <proof.icon className="size-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-950">{proof.title}</h3>
                  <p className="text-sm leading-7 text-slate-600">{proof.description}</p>
                </div>
              ))}
            </div>

            <div className="pixel-panel border-slate-900 bg-slate-950 px-5 py-5 text-white">
              <div className="flex items-center gap-3 text-amber-200">
                <IconCloudLock className="size-5" />
                <span className="font-pixel text-[10px]">SYSTEM READY</span>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                如果你真正关心的是能不能接入仓库、能不能协作、能不能离线部署，那 MonkeyCode 给出的不是抽象概念，而是明确的产品路径。
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {platformTags.map((tag) => (
                  <span
                    key={tag}
                    className="border-2 border-white/15 bg-white/6 px-3 py-2 text-xs text-slate-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default GitBot;
