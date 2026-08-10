// 云端任务启动时间线(task.status = pending):虚拟机准备是以分钟计的过程,
// 按 virtualmachine.conditions 展开成时间线——已完成打勾、当前项转圈(可带
// 进度条)、失败项红点带原因。状态语义与移动端 starting 分支同源。
import { IconCheck } from "@tabler/icons-react";

import { useI18n, type MessageKey } from "@/lib/i18n";
import type { CloudTaskDetail, VmCondition } from "@/lib/ipc/cloudtasks";

/** conditions[].status:0 未知 / 1 进行中 / 2 完成 / 3 失败 */
const DONE = 2;
const FAILED = 3;

export interface StartupStep {
  type: string;
  state: "done" | "active" | "failed";
  /** 0-100;仅当前项且服务端给了才画进度条 */
  progress?: number;
  message?: string;
}

/**
 * conditions → 时间线(纯函数,单测覆盖)。服务端按阶段追加(同一阶段可能
 * 带着进度重复下发),故按 type 去重保留最后一次,顺序以首次出现为准:
 * 进度刷新不会让步骤跳位。除最后一项外都算已完成(服务端进入下一阶段就
 * 意味着上一阶段过了);最后一项按 status 判定 完成/进行中/失败。
 */
export function startupSteps(meta: CloudTaskDetail | null): StartupStep[] {
  const conds = meta?.virtualmachine?.conditions ?? [];
  const order: string[] = [];
  const last = new Map<string, VmCondition>();
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
      state,
      ...(state === "active" && typeof c.progress === "number" && c.progress > 0 ? { progress: c.progress } : {}),
      ...(c.message ? { message: c.message } : {}),
    };
  });
}

/** 阶段 → 短标签的词典键(未知阶段回落原词)。 */
const STEP_KEYS = new Set([
  "Scheduled",
  "ImagePulled",
  "ProjectCloned",
  "ImageBuilt",
  "ContainerCreated",
  "ContainerStarted",
  "Ready",
  "Failed",
]);

function StepRow({ step }: { step: StartupStep }) {
  const { t } = useI18n();
  const label = STEP_KEYS.has(step.type) ? t(`cloud.startup.step.${step.type}` as MessageKey) : step.type;
  return (
    <li className="flex items-start gap-2">
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {step.state === "done" && <IconCheck size={14} stroke={1.75} aria-hidden className="text-success" />}
        {step.state === "active" && <span className="loading loading-spinner loading-xs text-primary" aria-hidden />}
        {step.state === "failed" && <span aria-hidden className="status status-error" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 pb-0.5">
        <span className="flex items-center gap-2">
          <span
            className={
              step.state === "failed"
                ? "text-xs font-semibold text-error"
                : step.state === "active"
                  ? "text-xs font-semibold"
                  : "text-xs text-base-content/50"
            }
          >
            {label}
          </span>
          {step.progress !== undefined && (
            <span className="font-mono text-xs text-base-content/50 tabular-nums">{step.progress}%</span>
          )}
        </span>
        {step.progress !== undefined && (
          <progress className="progress progress-primary h-1 w-40" value={Math.min(100, step.progress)} max={100} />
        )}
        {/* 详情只在当前/失败步骤展开:已完成步骤的 message 是噪音 */}
        {step.message && step.state !== "done" && (
          <span className={`text-xs leading-relaxed break-words ${step.state === "failed" ? "text-error" : "text-base-content/50"}`}>
            {step.message}
          </span>
        )}
      </span>
    </li>
  );
}

/** 启动卡:标题 + 阶段时间线 + 说明。 */
export function StartupTimeline({ meta }: { meta: CloudTaskDetail | null }) {
  const { t } = useI18n();
  const steps = startupSteps(meta);
  const failed = steps.some((s) => s.state === "failed");
  const active = steps.find((s) => s.state === "active");
  const title = failed
    ? t("cloud.startup.failed")
    : active
      ? t("cloud.startup.doing", {
          step: STEP_KEYS.has(active.type) ? t(`cloud.startup.step.${active.type}` as MessageKey) : active.type,
        })
      : t("cloud.startup.preparing");
  return (
    <div role="status" className="card card-border w-full max-w-md bg-base-100">
      <div className="flex flex-col gap-3 p-5">
        <div className={`text-sm font-semibold ${failed ? "text-error" : ""}`}>{title}</div>
        <ul className="flex flex-col gap-2">
          {steps.length === 0 ? (
            <StepRow step={{ type: "Scheduled", state: "active", message: t("cloud.startup.queued") }} />
          ) : (
            steps.map((s) => <StepRow key={s.type} step={s} />)
          )}
        </ul>
        <div className="border-t border-base-300 pt-3 text-xs leading-relaxed text-base-content/50">
          {failed ? t("cloud.startup.failedHint") : t("cloud.startup.hint")}
        </div>
      </div>
    </div>
  );
}
