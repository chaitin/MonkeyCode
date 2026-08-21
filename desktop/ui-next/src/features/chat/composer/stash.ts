// 每会话 composer 暂存与统一的 FIFO 在途协调。
// 队首在 IPC 提交和帧确认之间仍保留在 queue；模块级 flight 保证活动视图与
// 后台投递对同一 sessionId 最多只有一个发送者，视图卸载也不会丢失所有权。
import { sessionSend } from "@/lib/ipc/sessions";
import { b64encode } from "@/lib/protocol/codec";
import { attLineOf } from "@/lib/protocol/attLine";
import type { ComposerAtt, QueueItem } from "./useComposer";

export interface StashEntry {
  draft: string;
  queue: QueueItem[];
  atts: ComposerAtt[];
}

interface QueueFlight {
  item: QueueItem;
  payload: string;
  phase: "sending" | "accepted";
  onAccepted?: (id: string, text: string) => void;
  acceptedNotified: boolean;
}

interface ActiveComposerBinding {
  id: string;
  confirmed(item: QueueItem): void;
  failed(item: QueueItem, error: unknown): void;
}

const stash = new Map<string, StashEntry>();
const flights = new Map<string, QueueFlight>();
let active: ActiveComposerBinding | null = null;

export function stashGet(id: string): StashEntry | undefined {
  return stash.get(id);
}

/** 空档不占条目；复制数组，避免暂存与活动 composer 共享可变引用。 */
export function stashSet(id: string, entry: StashEntry): void {
  if (entry.draft || entry.queue.length || entry.atts.length) {
    stash.set(id, { ...entry, queue: [...entry.queue], atts: [...entry.atts] });
  } else {
    stash.delete(id);
  }
}

export function dropStash(id: string): void {
  stash.delete(id);
  flights.delete(id);
}

export function queueFlightId(id: string): string | null {
  return flights.get(id)?.item.id ?? null;
}

/** 登记活动 composer；返回当前共享 flight，供切入后台在途会话时立即锁定。 */
export function bindActiveComposer(
  id: string,
  callbacks: Omit<ActiveComposerBinding, "id">,
): { flightId: string | null; unbind(): void } {
  const binding: ActiveComposerBinding = { id, ...callbacks };
  active = binding;
  return {
    flightId: queueFlightId(id),
    unbind: () => {
      if (active === binding) active = null;
    },
  };
}

const payloadOf = (item: QueueItem) =>
  [item.text.trim(), ...item.atts.map((att) => attLineOf(att.path, att.isImage))].filter(Boolean).join("\n");

const notifyAccepted = (id: string, flight: QueueFlight) => {
  if (flight.acceptedNotified) return;
  flight.acceptedNotified = true;
  flight.onAccepted?.(id, flight.payload);
};

/**
 * 统一取得某会话队首的发送所有权。项目不出队，直到 confirmQueueFlight 收到
 * 帧水位/运行状态确认；reject 只释放 flight，原项目天然仍在原位置。
 */
export function startQueueFlight(
  id: string,
  item: QueueItem,
  onAccepted?: (id: string, text: string) => void,
): boolean {
  if (flights.has(id)) return false;
  const payload = payloadOf(item);
  flights.set(id, { item, payload, phase: "sending", onAccepted, acceptedNotified: false });
  void sessionSend(id, "user-input", { content: b64encode(payload) }).then(
    () => {
      const flight = flights.get(id);
      if (!flight || flight.item.id !== item.id) return;
      flight.phase = "accepted";
      notifyAccepted(id, flight);
    },
    (error: unknown) => {
      const flight = flights.get(id);
      if (!flight || flight.item.id !== item.id) return;
      flights.delete(id);
      if (active?.id === id) active.failed(item, error);
    },
  );
  return true;
}

/** 帧已确认队首物化：清 flight，并从 stash/活动视图中按稳定 id 移除。 */
export function confirmQueueFlight(id: string): boolean {
  const flight = flights.get(id);
  if (!flight) return false;
  notifyAccepted(id, flight);
  flights.delete(id);
  const entry = stash.get(id);
  if (entry) stashSet(id, { ...entry, queue: entry.queue.filter((item) => item.id !== flight.item.id) });
  if (active?.id === id) active.confirmed(flight.item);
  return true;
}

/** 后台状态接线：running 是上一条 user-input 已物化的确认；其他可发送状态
 * 仅在没有共享 flight 时尝试取得队首所有权。 */
export function deliverQueued(id: string, status: string, onDelivered?: (id: string, text: string) => void): void {
  const flight = flights.get(id);
  if (flight) {
    if (status === "running") confirmQueueFlight(id);
    return;
  }
  if (status === "running" || status === "created" || active?.id === id) return;
  const item = stash.get(id)?.queue[0];
  if (item) startQueueFlight(id, item, onDelivered);
}

/** 仅供测试。 */
export function resetStashForTests(): void {
  stash.clear();
  flights.clear();
  active = null;
}
