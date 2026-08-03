// 展示型组件:消息、思考、工具卡片、计划卡、审批卡、diff 等。
// 样式值取自「MonkeyCode 桌面应用设计」(浅色绿调),逐一对应,不另行发挥。
//
// 本文件只做转口:实现已按关注点拆分到下列模块,消费方的 import 面保持不变
// (新代码可直接 import 具体模块,这里保留旧入口以免一次性改动十余个调用点)。
export { CodeView } from "./codeView";
export { DiffPanel } from "./diffView";
export { MONO } from "./fonts";
export { LogList } from "./logView";
export {
  OutlineNav,
  OUTLINE_JUMP_INSET,
  mergeLiveOutline,
  outlineActiveSeq,
  outlineEntries,
  type OutlineEntry,
} from "./outline";
export { Markdown } from "./markdown";
export { TaskPanel } from "./taskPanel";
export { ToolCard } from "./toolCard";
export { ConfirmPane, DeleteMenuItem, HeaderFilesButton, HeaderMenu, HeaderSummary, ViewHeader, useRenameDraft } from "./viewChrome";
export type { MenuState, RenameDraft } from "./viewChrome";
