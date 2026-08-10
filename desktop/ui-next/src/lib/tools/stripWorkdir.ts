// 标题里的工作区绝对路径收敛为相对路径(旧工程 toolCard.tsx 内联函数移植)。
// 历史会话标题已落盘,只能渲染时处理;workdir 的正/反斜杠两种形态都剥,
// 剥的是"目录 + 分隔符"前缀,workdir 本身不带尾随分隔符时也成立。

/** 把 text 中出现的 `<workdir>/` 或 `<workdir>\` 前缀去掉(全部出现处)。 */
export function stripWorkdir(text: string, workdir?: string): string {
  if (!workdir) return text;
  const slashDir = workdir.replace(/\\/g, "/").replace(/\/$/, "");
  const backslashDir = workdir.replace(/\//g, "\\").replace(/\\$/, "");
  return text.split(slashDir + "/").join("").split(backslashDir + "\\").join("");
}
