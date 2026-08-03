// composer 纯逻辑:斜杠指令(Agent 上报的 available_commands)的识别/过滤/
// 回填与键盘循环,以及 IME 组合态的 Enter 守卫。零 DOM,表驱动测试钉死。
import type { SlashCommand } from "@/lib/protocol/types";

/** 输入框正在敲斜杠指令时返回查询词(不含 /),否则 null。
 *
 * 只认「整段输入以 / 开头且还没敲空格」这一种形态:指令必须是整条消息的
 * 开头,句中出现的 `/` 是路径/日期,弹菜单是打扰;空格后进入「填参数」
 * 阶段,指令已选定,不再补全。 */
export function slashQuery(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const q = input.slice(1);
  return /\s/.test(q) ? null : q;
}

/** 按查询词过滤:名字前缀匹配优先于子串匹配(敲 co 先给 /compact 而非
 * /add-context),描述子串命中排最后一档。 */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const prefix: SlashCommand[] = [];
  const rest: SlashCommand[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(c);
    else if (name.includes(q) || (c.description ?? "").toLowerCase().includes(q)) rest.push(c);
  }
  return [...prefix, ...rest];
}

/** 选中指令后的输入框内容:一律补一个尾随空格(指令名与参数的分隔符;
 * 本地会话发送前会 trim,补了无害,云端按 `/name args` 解析则必需)。 */
export function commandText(cmd: Pick<SlashCommand, "name">): string {
  return `/${cmd.name} `;
}

/** 键盘导航后的高亮下标(列表为空回 0;上下越界回绕)。 */
export function cycleIndex(active: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (active + delta + length) % length;
}

// ==================== IME 组合态的 Enter 守卫 ====================

/** compositionend 之后多久内的 Enter 视为「同一次选字确认」。
 * Chromium 上组合态 keydown 的 isComposing 即为 true;但 WebKit(macOS 壳的
 * WKWebView)顺序相反——compositionend 先于 keydown 触发且 isComposing 已
 * 复位,只能靠时间窗补判。人手连按远慢于 100ms,不会误伤真实发送。 */
export const IME_ENTER_WINDOW_MS = 100;

export interface ImeGuard {
  /** compositionend 时刻记录(事件 timeStamp)。 */
  markEnd(timeStamp: number): void;
  /** 这一下 Enter 是否属于 IME 选字(组合中,或落在组合刚结束的时间窗内)。 */
  isImeEnter(timeStamp: number, isComposing: boolean): boolean;
}

/** 每个输入框一份守卫实例(时刻状态互不串扰)。 */
export function createImeGuard(): ImeGuard {
  let endedAt = -Infinity;
  return {
    markEnd(timeStamp) {
      endedAt = timeStamp;
    },
    isImeEnter(timeStamp, isComposing) {
      return isComposing || timeStamp - endedAt < IME_ENTER_WINDOW_MS;
    },
  };
}

/** 发送前补指令分隔符:整条消息恰好是 `/<已知指令名>`(前后无参数)时补一个
 * 尾随空格,其余原样。云端按 `/name args` 解析,缺了这个空格整条消息会被当成
 * 普通文本;而句中的 /path、未知的 /xxx 都不该被动。 */
export function withCommandSeparator(input: string, commands: readonly SlashCommand[]): string {
  const q = slashQuery(input);
  if (q === null || !q) return input;
  return commands.some((c) => c.name === q) ? `${input} ` : input;
}
