/** 引擎思考流按 chunk 裸拼,相邻加粗标题会连成 `**A****B**`;markdown
 * 解析会把中间的 `****` 当字面量吞进同一个 strong,先补成段落边界再交给
 * 渲染层。(移植旧 UI logView.tsx 的同名修复。) */
export function thoughtMarkdown(text: string): string {
  return text.replace(/\*{4}/g, "**\n\n**");
}

/** 折叠态摘要行的源文:取首个非空行并设上限。
 * 上限只是 DOM 体量的护栏(整段无换行的思考,首行 = 全文),视觉截断交给
 * CSS truncate。
 * 末尾补 `**` 不能省:截断可能把一对 `**` 切开,而 marked 对不成对的强调
 * 是**连同前导 `**` 原样吐出**——本来只想少显示几个字,结果整行开头多出
 * 两颗星,比不渲染还难看。 */
export function thoughtSummary(md: string, max = 80): string {
  const line = md.split("\n").find((l) => l.trim()) ?? "";
  const cut = line.slice(0, max);
  return (cut.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? `${cut}**` : cut;
}
