import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { installShellChrome } from "@/app/shellChrome";
import { applyPlatformAttr } from "@/lib/ipc/host";
import { applyStoredTheme } from "@/lib/theme";
import { applyUiScale, readUiScale } from "@/lib/uiScale";
import "@/styles/app.css";
import "@/styles/chrome.css";
import "@/styles/md.css";
import "@/styles/term.css";

// 首帧主题由 index.html 内联脚本落;这里兜底(脚本被 CSP 之类挡掉时)
applyStoredTheme();
// 界面缩放(WebView zoom):记住的档位在首帧前应用,避免启动后跳一下
applyUiScale(readUiScale());
// data-platform 落根节点(mac 红绿灯让位等平台分支的依据)
applyPlatformAttr();
// 壳级 chrome:右键拦截换自绘文本菜单、F12 devtools(浏览器模式不装)
installShellChrome();

const root = document.getElementById("root");
if (!root) throw new Error("index.html 缺 #root 挂载点");
// StrictMode(仅开发期生效,生产构建被剥掉):双挂载能当场暴露 effect 不幂等、
// 清理漏做、"旧 id 短路"这类问题——ChatView/CloudTaskView 里多处注释记的正是
// 靠它抓到的坑。旧工程一直开着,ui-next 首版漏迁(2026-08-09 补回)。
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
