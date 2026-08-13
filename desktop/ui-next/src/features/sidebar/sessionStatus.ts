// 会话行的状态语汇(词表 + 行尾点):从 Sidebar.tsx 摘出成独立小模块——
// 侧栏会话行与待办组(features/todo/TodoSection)都要按同一张表回查关联
// 会话的状态,留在 Sidebar 里会让 TodoSection 反向 import 视图组件成环。
import type { useI18n } from "@/lib/i18n";
import type { SessionMeta } from "@/lib/ipc/sessions";

type T = ReturnType<typeof useI18n>["t"];

/** 行尾状态点(用户定案 2026-08-05「文字换状态图标」):仅要紧态给彩点,
 * 静默态无点(轮次进 tooltip);状态词进点的 title/aria。attention(D3
 * 后台提醒未读)也在此:终态用警示点点出来,点开行即消。 */
export function rowTrailing(meta: SessionMeta, t: T, attention: boolean): { tone: string; label: string; pulse?: boolean } | null {
  // pulse = 进行中的活态(点 + 扩散环);未读/出错是静态终态,给静点即可
  if (meta.waiting_ask) return { tone: "status-warning", label: t("status.waitingAsk"), pulse: true };
  if (attention) return { tone: "status-warning", label: t("status.attention") };
  if (meta.status === "running") return { tone: "status-primary", label: t("status.running"), pulse: true };
  if (meta.status === "error") return { tone: "status-error", label: t("status.error") };
  return null;
}

/** 行状态词(与旧 UI sidebar.rowStatus 同一张表):**每种状态都有词**,
 * 要紧态另由 rowTrailing 给一个彩点,静默态就只剩这个词——它进行 tooltip,
 * 不上行(LAYOUT §6.1「文字状态词不上行」、「终态词收进行 tooltip」)。
 *
 * 为什么补这个函数:§6.1 承诺的是「安静的状态词搬进 tooltip」,而实现里只有
 * status.turns 搬过去了,status.interrupted / idle / notStarted 三条在 zh.ts 里
 * 成了没人读的孤儿键——tooltip 只插值 trailing?.label,而这三种状态压根不给
 * trailing。结果是「已停止 / 可继续 / 尚未开始」在界面上无处可查:被引擎崩溃
 * 打断的后台任务,行上没点、tooltip 里也没词,彻底隐身。 */
export function rowStatusLabel(meta: SessionMeta, t: T): string {
  if (meta.waiting_ask) return t("status.waitingAsk");
  switch (meta.status) {
    case "running":
      return t("status.running");
    case "error":
      return t("status.error");
    case "interrupted":
      return t("status.interrupted");
    case "idle":
    case "finished": // 旧版壳顶层会话的「一轮结束」;新壳一律回 idle
      return t("status.idle");
    default:
      return meta.turns > 0 ? t("status.idle") : t("status.notStarted");
  }
}
