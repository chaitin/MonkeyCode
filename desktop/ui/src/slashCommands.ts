// 斜杠指令(Agent 上报的 available_commands)的纯逻辑:输入框里"正在敲的
// 指令"识别、过滤排序、选中后的回填文本。UI 在 commandMenu.tsx,这里不触 DOM。
import type { SlashCommand } from "./types";

/** 输入框正在敲斜杠指令时返回查询词(不含 /),否则 null。
 *
 * 只认"整段输入以 / 开头且还没敲空格"这一种形态:指令必须是整条消息的
 * 开头(云端按 `/name args` 解析),句中出现的 `/` 是路径/日期,弹菜单是打扰。 */
export function slashQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const q = input.slice(1);
  // 空格后即进入"填参数"阶段,指令已选定,不再补全
  return /[\s]/.test(q) ? null : q;
}

/** 按查询词过滤:前缀匹配优先于子串匹配(敲 co 先给 /compact 而非 /add-context) */
export function filterCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const prefix: SlashCommand[] = [];
  const rest: SlashCommand[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(c);
    else if (name.includes(q) || (c.description ?? "").toLowerCase().includes(q)) rest.push(c);
  }
  return [...prefix, ...rest];
}

/** 选中指令后的输入框内容:一律补一个尾随空格。
 * 有参数提示的,光标随即等着填参数;没参数的也要补——云端按 `/name args`
 * 解析,指令名后的空格是分隔符,缺了它整条消息会被当普通文本(本地会话这一路
 * 发送前会 trim,补不补都一样)。 */
export function commandText(cmd: SlashCommand): string {
  return `/${cmd.name} `;
}

/** 键盘导航后的高亮下标(列表为空回 0;上下越界回绕) */
export function nextActive(active: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (active + delta + length) % length;
}

/** 发送前补指令分隔符:整条消息恰好是 `/<已知指令名>`(前后无参数)时补一个
 * 尾随空格,其余原样。云端按 `/name args` 解析,缺了这个空格整条消息会被当成
 * 普通文本;而句中的 /path、未知的 /xxx 都不该被动。 */
export function withCommandSeparator(input: string, commands: SlashCommand[]): string {
  const q = slashQuery(input);
  if (q === null || !q) return input;
  return commands.some((c) => c.name === q) ? `${input} ` : input;
}
