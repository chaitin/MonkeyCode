// 实时任务面板:todo 列表的收起摘要 / 展开勾选列表与依赖提示。
import { useState } from "react";
import {
  IconChevronRight,
  IconTaskBlocked,
  IconTaskDone,
  IconTaskPending,
  IconTaskRunning,
} from "./icons";
import type { PlanEntry } from "./types";

/** 实时任务面板:钉在 composer 上方,不进对话流。收起 = 一行摘要
 * (进度 + 当前项),展开 = 限高滚动的勾选列表;整卡随 todo_update 更新。 */
export function TaskPanel({ entries }: { entries: PlanEntry[] }) {
  const [open, setOpen] = useState(false);
  const done = entries.filter((e) => e.status === "completed").length;
  const current = entries.find((e) => e.status === "in_progress") ?? entries.find((e) => e.status === "pending");
  // 依赖提示(上游 todo_update 携带 id/depends_on 时):id → 序号与标题,
  // blocked 缺省按"有未完成依赖"本地推导
  const byId = new Map(entries.map((e, i) => [e.id ?? "", { idx: i + 1, e }]));
  const unfinishedDeps = (e: PlanEntry) =>
    (e.depends_on ?? []).filter((d) => byId.get(d)?.e.status !== "completed");
  const isBlocked = (e: PlanEntry) =>
    e.status !== "completed" && (e.blocked ?? unfinishedDeps(e).length > 0);
  const depHint = (e: PlanEntry) => {
    const deps = unfinishedDeps(e);
    if (!deps.length) return null;
    const names = deps.map((d) => byId.get(d)).filter(Boolean).map((x) => `#${x!.idx}`);
    return names.length ? `等 ${names.join(" ")}` : null;
  };
  const statusIcon = (status: string, blocked: boolean, size = 12) => {
    if (blocked) return <IconTaskBlocked size={size} />;
    if (status === "completed") return <IconTaskDone size={size} />;
    if (status === "in_progress") return <IconTaskRunning size={size} />;
    return <IconTaskPending size={size} />;
  };
  // 有任何依赖关系时全员编号,"等 #N" 才有落点
  const numbered = entries.some((e) => e.depends_on?.length);
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: 11, boxShadow: "none", animation: "mcin .18s ease" }}>
      <button
        className="hv2"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", border: "none", background: "transparent",
          cursor: "pointer", font: "inherit", fontSize: 12, textAlign: "left",
        }}
      >
        {statusIcon(done === entries.length && entries.length > 0 ? "completed" : "in_progress", false, 13)}
        <span style={{ fontWeight: 600 }}>
          任务 {done}/{entries.length}
        </span>
        {!open && current && (
          <span className="ellipsis" style={{ color: "var(--t4)", flex: 1, minWidth: 0 }}>
            · {current.status === "in_progress" ? "正在" : "接下来"}：{current.content}
          </span>
        )}
        <IconChevronRight
          size={9}
          color="var(--t5)"
          style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
        />
      </button>
      {open && (
        <div style={{ maxHeight: 176, overflowY: "auto", padding: "0 12px 9px", display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
          {entries.map((e, i) => {
            const blocked = isBlocked(e);
            const hint = depHint(e);
            return (
              <div
                key={i}
                style={{
                  color: e.status === "completed" ? "var(--t5)" : blocked ? "var(--t4)" : e.status === "in_progress" ? "var(--accTx)" : "var(--t2)",
                  textDecoration: e.status === "completed" ? "line-through" : "none",
                }}
                title={hint ? `依赖未完成: ${hint}` : undefined}
              >
                <span style={{ display: "inline-flex", width: 18, verticalAlign: -2 }}>
                  {statusIcon(e.status, blocked)}
                </span>
                {numbered && <span style={{ color: "var(--t5)", marginRight: 5, fontSize: 11 }}>#{i + 1}</span>}
                {e.content}
                {hint && <span style={{ color: "var(--t5)", fontSize: 11, marginLeft: 6 }}>· {hint}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
