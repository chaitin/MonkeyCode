// 云端任务启动页(task.status = pending):虚拟机准备是以分钟计的过程,
// 原先只有一条"云端开发环境:拉取镜像 42%"的黄条,用户看不出还要多久、
// 卡在哪一步、失败了能不能救。这里按 virtualmachine.conditions 展开成
// 一条时间线:已完成的打勾、当前项转圈带进度条、失败项红色带原因。
//
// 与移动端(mobile/app/task/[id].tsx 的 starting 分支)同一份状态语义,
// 但桌面不退化成只读等待页——composer 保持可用,启动期输入自动排队,
// 环境就绪即送达(这是桌面侧独有的能力,页面上要说清楚)。
import { MONO } from "./fonts";
import { IconCheck, IconCloud } from "./icons";
import type { CloudTaskDetail } from "./types";

/** conditions[].status:0 未知 / 1 进行中 / 2 完成 / 3 失败 */
const DONE = 2;
const FAILED = 3;

/** 准备阶段 → 短标签(对齐 web getConditionTypeText / mobile CONDITION_LABELS) */
const STEP_LABEL: Record<string, string> = {
  Scheduled: "调度到宿主机",
  ImagePulled: "拉取系统镜像",
  ProjectCloned: "克隆代码仓库",
  ImageBuilt: "构建系统镜像",
  ContainerCreated: "创建开发环境",
  ContainerStarted: "启动开发环境",
  Ready: "环境就绪",
  Failed: "环境启动失败",
};

export interface StartupStep {
  type: string;
  label: string;
  state: "done" | "active" | "failed";
  /** 0-100;仅当前项且服务端给了才画进度条 */
  progress?: number;
  message?: string;
}

/**
 * conditions → 时间线。服务端按阶段追加(同一阶段可能带着进度重复下发),
 * 故按 type 去重保留最后一次,顺序以首次出现为准:进度刷新不会让步骤跳位。
 *
 * 除最后一项外都算已完成(服务端进入下一阶段就意味着上一阶段过了);
 * 最后一项按 status 判定 完成/进行中/失败。
 */
export function startupSteps(meta: CloudTaskDetail | null): StartupStep[] {
  const conds = meta?.virtualmachine?.conditions ?? [];
  const order: string[] = [];
  const last = new Map<string, { status?: number; message?: string; progress?: number }>();
  for (const c of conds) {
    const type = c.type ?? "";
    if (!type) continue;
    if (!last.has(type)) order.push(type);
    last.set(type, c);
  }
  return order.map((type, i) => {
    const c = last.get(type)!;
    const tail = i === order.length - 1;
    const failed = c.status === FAILED || type === "Failed";
    const state: StartupStep["state"] = failed ? "failed" : !tail || c.status === DONE ? "done" : "active";
    return {
      type,
      label: STEP_LABEL[type] ?? type,
      state,
      ...(state === "active" && typeof c.progress === "number" && c.progress > 0 ? { progress: c.progress } : {}),
      ...(c.message ? { message: c.message } : {}),
    };
  });
}

/** 标题:失败外显失败,否则以当前步骤说明"正在做什么" */
export function startupTitle(steps: StartupStep[]): string {
  const failed = steps.find((s) => s.state === "failed");
  if (failed) return "云端开发环境启动失败";
  const active = steps.find((s) => s.state === "active");
  return active ? `正在${active.label}…` : "正在准备云端开发环境…";
}

function StepRow({ step }: { step: StartupStep }) {
  const color = step.state === "failed" ? "var(--err)" : step.state === "active" ? "var(--t2)" : "var(--t5)";
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
      <span style={{ flex: "none", width: 14, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {step.state === "done" && <IconCheck size={11} strokeWidth={1.8} />}
        {step.state === "active" && (
          <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
        )}
        {step.state === "failed" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--err)" }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingBottom: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: step.state === "done" ? 400 : 600, color }}>{step.label}</span>
          {step.progress !== undefined && (
            <span style={{ fontSize: 11, color: "var(--t5)", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
              {step.progress}%
            </span>
          )}
        </span>
        {step.progress !== undefined && (
          // 限宽:满宽的细线会被当成分隔线,收窄后才读得出是进度条
          <span style={{ height: 3, maxWidth: 200, borderRadius: 2, background: "var(--line2)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.min(100, step.progress)}%`, background: "var(--acc)", transition: "width .3s ease" }} />
          </span>
        )}
        {/* 详情只在当前/失败步骤展开:已完成步骤的 message 是噪音 */}
        {step.message && step.state !== "done" && (
          <span style={{ fontSize: 11.5, lineHeight: 1.5, color: step.state === "failed" ? "var(--err)" : "var(--t5)", wordBreak: "break-word" }}>
            {step.message}
          </span>
        )}
      </span>
    </div>
  );
}

/** 启动卡:标题 + 阶段时间线 + 排队说明(composer 仍可用) */
export function CloudStartupCard({ meta, queued }: { meta: CloudTaskDetail | null; queued?: boolean }) {
  const steps = startupSteps(meta);
  const failed = steps.some((s) => s.state === "failed");
  const title = startupTitle(steps);
  return (
    <div className="card" style={{ width: "100%", maxWidth: 460, padding: "18px 20px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flex: "none",
            width: 30,
            height: 30,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: failed ? "var(--errBg)" : "var(--accBgSoft)",
          }}
        >
          <IconCloud size={15} color={failed ? "var(--err)" : "var(--accTx)"} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: failed ? "var(--err)" : "var(--t1)" }}>{title}</span>
          <span style={{ fontSize: 11.5, color: "var(--t5)" }}>
            {failed ? "可在 ⋯ 菜单终止任务后重新创建" : "云端虚拟机首次准备通常需要 1–3 分钟"}
          </span>
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {steps.length === 0 ? (
          <StepRow step={{ type: "Scheduled", label: "排队等待调度", state: "active" }} />
        ) : (
          steps.map((s) => <StepRow key={s.type} step={s} />)
        )}
      </div>

      {!failed && (
        <div style={{ borderTop: "1px solid var(--line2)", paddingTop: 11, fontSize: 11.5, lineHeight: 1.6, color: "var(--t5)" }}>
          {queued
            ? "已排队的内容会在环境就绪后自动送达,可以先去忙别的。"
            : "现在就能在下方输入——内容会先排队,环境就绪后自动送达。"}
          <br />
          任务跑在云端服务器上,关掉客户端也会继续。
        </div>
      )}
    </div>
  );
}
