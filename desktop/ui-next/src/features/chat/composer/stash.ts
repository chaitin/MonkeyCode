// 每会话 composer 只暂存草稿与当前附件；待发送消息由 sendQueue 按 sid 持久化。
// 后台补投由 App 的 session-status 事件驱动，每个轮末至多领取一个队首项。
import { sessionSend } from "@/lib/ipc/sessions";
import { attLineOf } from "@/lib/protocol/attLine";
import { b64encode } from "@/lib/protocol/codec";
import {
  claimHead,
  completeTurn,
  dropLocalSendQueue,
  localSendQueueTarget,
  markReceipt,
  nackHead,
  readSendQueueLane,
  resumeAutomatic,
  updateSendQueueLane,
  type LocalQueueAttachment,
  type SendQueueLane,
} from "./sendQueue";
import type { ComposerAtt } from "./useComposer";

export interface StashEntry {
  draft: string;
  atts: ComposerAtt[];
}

const stash = new Map<string, StashEntry>();

// 活跃 composer 自己依据 historyLoaded/stateSid/lastSeq/running 投递；分屏可同时
// 挂载多个会话，App 只接管完全没有 composer owner 的后台会话。
const activeComposers = new Map<string, number>();
// 每个 sid 最多一个后台 IPC；值是稳定 item id，迟到回调必须同时匹配 sid 与 item。
const dispatching = new Map<string, string>();

export function stashGet(id: string): StashEntry | undefined {
  return stash.get(id);
}

/** 空档不占条目。 */
export function stashSet(id: string, entry: StashEntry): void {
  if (entry.draft || entry.atts.length) stash.set(id, entry);
  else stash.delete(id);
}

/** 删除会话成功后同时清草稿暂存、后台 token 与持久 lane。 */
export function dropStash(id: string): void {
  stash.delete(id);
  dispatching.delete(id);
  dropLocalSendQueue(id);
}

/** useComposer 挂载/切会话时登记；同一会话的重复 owner 用引用计数注销。 */
export function bindActiveComposer(id: string): () => void {
  activeComposers.set(id, (activeComposers.get(id) ?? 0) + 1);
  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    const count = activeComposers.get(id) ?? 0;
    if (count <= 1) activeComposers.delete(id);
    else activeComposers.set(id, count - 1);
  };
}

function messageOf(item: { content: string; attachments: LocalQueueAttachment[] }): string {
  return [item.content.trim(), ...item.attachments.map((att) => attLineOf(att.path, att.isImage))]
    .filter(Boolean)
    .join("\n");
}

function advanceForStatus(
  lane: SendQueueLane<LocalQueueAttachment>,
  status: string,
): SendQueueLane<LocalQueueAttachment> {
  let next = lane;
  const inFlightId = next.inFlight?.item.id;

  if (status === "running" || status === "created") {
    // running 是可信开轮信号，只自动解除传输故障，不能覆盖用户主动暂停。
    next = resumeAutomatic(next);
    return inFlightId ? markReceipt(next, inFlightId) : next;
  }

  // 非运行状态代表一轮结束；只完成已经确认开轮的项。
  if (inFlightId && next.inFlight?.phase === "awaiting-turn-end") {
    next = completeTurn(next, inFlightId);
  } else if (next.inFlight) {
    return next;
  }

  // 新的状态边沿只自动解除传输故障；用户暂停与 uncertain 必须显式确认。
  next = resumeAutomatic(next);
  return claimHead(next, { phase: "awaiting-receipt" });
}

/**
 * 后台会话状态变更(App 的 session-event 接线)：running 只确认开轮；轮末只完成
 * 当前 in-flight 并领取一个队首。发送成功后仍等待下一组 session-status，绝不连投。
 */
export function deliverQueued(id: string, status: string, onDelivered?: (id: string, text: string) => void): void {
  if (activeComposers.has(id)) return;
  const target = localSendQueueTarget(id);
  const before = readSendQueueLane<LocalQueueAttachment>(target);
  const result = updateSendQueueLane<LocalQueueAttachment>(target, (lane) => advanceForStatus(lane, status));
  const inFlight = result.lane.inFlight;

  // 只有本次状态归约新领取的 awaiting-receipt 项才启动传输。
  if (
    status === "running" ||
    status === "created" ||
    !inFlight ||
    inFlight.phase !== "awaiting-receipt" ||
    before.inFlight?.item.id === inFlight.item.id ||
    dispatching.has(id)
  ) {
    return;
  }

  const itemId = inFlight.item.id;
  const text = messageOf(inFlight.item);
  dispatching.set(id, itemId);
  void sessionSend(id, "user-input", { content: b64encode(text) }).then(
    () => {
      if (dispatching.get(id) !== itemId) return;
      dispatching.delete(id);
      // Promise resolve 仅代表 transport 接受，lane 保持 awaiting-receipt 等 session-status。
      onDelivered?.(id, text);
    },
    (error: unknown) => {
      if (dispatching.get(id) !== itemId) return;
      dispatching.delete(id);
      updateSendQueueLane<LocalQueueAttachment>(target, (lane) =>
        nackHead(lane, itemId, {
          code: "send-rejected",
          message: error instanceof Error ? error.message : String(error),
          at: Date.now(),
        }),
      );
    },
  );
}

/** 仅供测试：清空模块级状态(stash、活跃登记与后台 token)。 */
export function resetStashForTests(): void {
  stash.clear();
  activeComposers.clear();
  dispatching.clear();
}
