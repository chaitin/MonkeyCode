/** 引擎思考流按 chunk 裸拼,相邻加粗标题会连成 `**A****B**`;markdown
 * 解析会把中间的 `****` 当字面量吞进同一个 strong,先补成段落边界再交给
 * 渲染层。(移植旧 UI logView.tsx 的同名修复。) */
export function thoughtMarkdown(text: string): string {
  return text.replace(/\*{4}/g, "**\n\n**");
}

/** 完成态折叠摘要取首个非空行。视觉省略交给卡片真实宽度上的 CSS
 * truncate，不在数据层叠加任意字符上限；只为上游本身未闭合的 ** 补尾，
 * 避免 marked 把星号原样露出来。 */
export function thoughtSummary(md: string): string {
  const line = md.split("\n").find((l) => l.trim()) ?? "";
  return (line.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? `${line}**` : line;
}

/** 流式折叠态展示最新一行的尾部，而不是永远钉在首行。
 *
 * 只查看末尾 max 个 UTF-16 单元附近：长思考每批 token 都会调用本函数，
 * 不能 split 全文或从头扫描。若窗口内有换行就取最后一行；无换行且全文
 * 已超长则加省略号，让用户明确看到这是正在移动的尾部而非静态摘要。
 * 返回值仍是 inline markdown；截断恰好带进一个孤立 ** 时按截断点之前的
 * 强调状态补齐，避免 marked 把星号原样露出来。 */
export function thoughtLiveSummary(text: string, max = 80): string {
  let end = text.length;
  while (end > 0 && /\s/u.test(text[end - 1]!)) end -= 1;
  if (end === 0) return "";

  const width = Math.max(1, max);
  const windowStart = Math.max(0, end - width);
  const tailWindow = text.slice(windowStart, end);
  const lineBreak = Math.max(tailWindow.lastIndexOf("\n"), tailWindow.lastIndexOf("\r"));
  let start = lineBreak >= 0 ? windowStart + lineBreak + 1 : windowStart;
  // slice 不得从 surrogate pair 中间起步（emoji 等会变成替换字符）。
  if (start < end && start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) {
    start += 1;
  }

  const truncated = start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r";
  let source = thoughtMarkdown(text.slice(start, end).trimStart());
  const strongCount = source.match(/\*\*/g)?.length ?? 0;
  if (strongCount % 2 === 1) {
    // 只有碰到孤立标记才回看前缀；常态路径始终只处理固定大小的尾窗。
    const insideStrong = (text.slice(0, start).match(/\*\*/g)?.length ?? 0) % 2 === 1;
    source = insideStrong ? `**${source}` : `${source}**`;
  }
  return `${truncated ? "…" : ""}${source}`;
}
