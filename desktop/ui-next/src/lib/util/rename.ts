// 会话改名提交的空转判定——ChatView 头部与 Sidebar 右键行内改名共用,
// 与壳 sidecar 的 title/title_custom 契约配对(session_patch {title})。
//
// 两条不直观的规则,分开写清:
// - **空提交要发**:清空 = 撤销自定义、回落自动链(壳摘 title_custom 并把
//   title 重填首句);只有「本就没改过名又提交空」才是纯空转。
// - **文本未变也可能要发**:旧版本的用户改名只写 title、没有 title_custom,
//   这类会话在头部/侧栏都按「未改名」优先显示 summary,输入框预填的又是
//   原标题——用户原文确认必须发一次 patch 补标记,否则怎么改都"没反应"。
//   头部在 4ab809db 修过这条,侧栏右键漏了同一口径(2026-08-12 用户报障),
//   判定自此收口在这一个函数里,不再两处各写一份。
export function renameIsNoop(
  next: string,
  meta: { title: string; title_custom?: boolean },
): boolean {
  return next ? next === meta.title && Boolean(meta.title_custom) : !meta.title_custom;
}
