// 实时任务面板(plan 帧驱动):钉在 composer 上方,不进对话流。
// 收起 = 一行摘要(进度 + 当前项),展开 = 限高滚动的只读勾选清单;
// 整卡随 plan 全量重发更新(daisyUI collapse 强制开合态)。
import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { PlanEntry } from "@/lib/protocol/types";

export function TaskPanel({ entries }: { entries: PlanEntry[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const done = entries.filter((e) => e.status === "completed").length;
  const current =
    entries.find((e) => e.status === "in_progress") ?? entries.find((e) => e.status === "pending");
  // 依赖提示(上游 todo_update 携带 id/depends_on 时):id → 序号,blocked
  // 缺省按「有未完成依赖」本地推导(旧 taskPanel.tsx 同款)
  const byId = new Map(entries.map((e, i) => [e.id ?? "", { idx: i + 1, entry: e }]));
  const unfinishedDeps = (e: PlanEntry) =>
    (e.depends_on ?? []).filter((d) => byId.get(d)?.entry.status !== "completed");
  const isBlocked = (e: PlanEntry) =>
    e.status !== "completed" && (e.blocked ?? unfinishedDeps(e).length > 0);
  const depHint = (e: PlanEntry) => {
    const names = unfinishedDeps(e)
      .map((d) => byId.get(d))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .map((x) => `#${x.idx}`);
    return names.length ? t("chat.plan.waitDeps", { list: names.join(" ") }) : null;
  };
  // 有任何依赖关系时全员编号,「等 #N」才有落点
  const numbered = entries.some((e) => e.depends_on?.length);

  return (
    <div
      className={`mc-workbench-material collapse rounded-box border border-base-300 ${open ? "collapse-open" : "collapse-close"}`}
    >
      <button
        type="button"
        aria-expanded={open}
        className="collapse-title flex min-h-0 items-center gap-2 px-3 py-2 text-xs"
        onClick={() => setOpen(!open)}
      >
        <span className="shrink-0 font-semibold">
          {t("chat.plan.progress", { done, total: entries.length })}
        </span>
        {!open && current && (
          <span className="min-w-0 flex-1 truncate text-left text-base-content/60">
            · {current.status === "in_progress" ? t("chat.plan.doing") : t("chat.plan.next")}:
            {current.content}
          </span>
        )}
        <IconChevronRight
          size={14}
          stroke={1.75}
          aria-hidden
          className={`ml-auto shrink-0 text-base-content/40 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      <div className="collapse-content px-3">
        <ul className="flex max-h-44 flex-col gap-1 overflow-x-hidden overflow-y-auto pb-1 text-xs">
          {entries.map((e, i) => {
            const blocked = isBlocked(e);
            const hint = depHint(e);
            return (
              <li key={e.id ?? i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className={`checkbox checkbox-xs mt-px shrink-0 ${e.status === "in_progress" ? "checkbox-primary" : ""}`}
                  checked={e.status === "completed"}
                  ref={(node) => {
                    if (node) node.indeterminate = e.status === "in_progress";
                  }}
                  readOnly
                  aria-label={e.content}
                />
                {numbered && (
                  <span className="shrink-0 text-base-content/40 tabular-nums">#{i + 1}</span>
                )}
                <span
                  className={
                    e.status === "completed"
                      ? "line-through opacity-50"
                      : blocked
                        ? "opacity-60" // blocked 行降色(比 completed 略实,旧 t4/t5 层级)
                        : e.status === "in_progress"
                          ? "font-medium text-primary"
                          : ""
                  }
                >
                  {e.content}
                  {hint && <span className="ml-1.5 text-base-content/60">· {hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
