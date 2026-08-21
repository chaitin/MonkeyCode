// 共享待发送队列领域层：纯状态转换、按目标隔离的 v1 持久化和模块内订阅。
// 传输层只能领取队首；领取结果须先经 writeSendQueueLane 持久化，再真正发送。

export const SEND_QUEUE_VERSION = 1 as const;
const STORAGE_PREFIX = "mc.sendQueue.v1";

export type SendQueueScope = "local" | "cloud";

export interface SendQueueItem<A> {
  id: string;
  content: string;
  attachments: A[];
  createdAt: number;
}

export type InFlightPhase = "dispatching" | "awaiting-receipt" | "awaiting-turn-end" | "uncertain";

export interface SendQueueInFlight<A> {
  item: SendQueueItem<A>;
  phase: InFlightPhase;
  baselineSeq?: number;
  startedAt: number;
}

export type SendQueueBlockCode =
  | "send-rejected"
  | "receipt-unknown"
  | "control-offline"
  | "transport-changed"
  | "unauthorized"
  | "vm-failed"
  | "task-ended"
  | "task-missing";

export interface SendQueueBlock {
  code: SendQueueBlockCode;
  message: string;
  at: number;
  /** nack 回队项的稳定 ID；存在时该项在解除阻塞前不能被后续项越过。 */
  itemId?: string;
}

export interface SendQueueLane<A> {
  version: typeof SEND_QUEUE_VERSION;
  pending: SendQueueItem<A>[];
  inFlight: SendQueueInFlight<A> | null;
  blocked: SendQueueBlock | null;
}

export interface LocalQueueAttachment {
  path: string;
  name: string;
  isImage: boolean;
}

export interface CloudQueueAttachment {
  url: string;
  filename: string;
  isImage: boolean;
}

export interface LocalSendQueueTarget {
  scope: "local";
  sessionId: string;
}

export interface CloudSendQueueTarget {
  scope: "cloud";
  accountScope: string;
  taskId: string;
}

export type SendQueueTarget = LocalSendQueueTarget | CloudSendQueueTarget;
export type AttachmentGuard<A> = (value: unknown) => value is A;

export interface ClaimMetadata {
  startedAt?: number;
  baselineSeq?: number;
  phase?: "dispatching" | "awaiting-receipt";
}

export interface RestoreOptions {
  /** 只有调用方已用可信运行状态确认该轮仍在运行时，才可继续等待轮末。 */
  awaitingTurnRunning?: boolean;
}

export interface SendQueueReadOptions<A> extends RestoreOptions {
  attachmentGuard?: AttachmentGuard<A>;
}

export interface SendQueuePersistenceState {
  ok: boolean;
  error: string | null;
}

export interface SendQueueWriteResult<A> extends SendQueuePersistenceState {
  lane: SendQueueLane<A>;
}

export interface SendQueueDropResult extends SendQueuePersistenceState {
  dropped: true;
}

export interface CloudAccountIdentity {
  logged_in?: boolean;
  host?: string | null;
  base_url?: string | null;
  user?: { id?: string | null } | null;
}

const PHASES = new Set<InFlightPhase>([
  "dispatching",
  "awaiting-receipt",
  "awaiting-turn-end",
  "uncertain",
]);
const BLOCK_CODES = new Set<SendQueueBlockCode>([
  "send-rejected",
  "receipt-unknown",
  "control-offline",
  "transport-changed",
  "unauthorized",
  "vm-failed",
  "task-ended",
  "task-missing",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function isLocalQueueAttachment(value: unknown): value is LocalQueueAttachment {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.isImage === "boolean"
  );
}

export function isCloudQueueAttachment(value: unknown): value is CloudQueueAttachment {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.filename === "string" &&
    typeof value.isImage === "boolean"
  );
}

function isItem<A>(value: unknown, attachmentGuard: AttachmentGuard<A>): value is SendQueueItem<A> {
  return (
    isRecord(value) &&
    hasText(value.id) &&
    typeof value.content === "string" &&
    isFiniteNumber(value.createdAt) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(attachmentGuard)
  );
}

function isBlock(value: unknown): value is SendQueueBlock {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    BLOCK_CODES.has(value.code as SendQueueBlockCode) &&
    typeof value.message === "string" &&
    isFiniteNumber(value.at) &&
    (value.itemId === undefined || hasText(value.itemId))
  );
}

export function isSendQueueLane<A>(
  value: unknown,
  attachmentGuard: AttachmentGuard<A> = (() => true) as unknown as AttachmentGuard<A>,
): value is SendQueueLane<A> {
  if (!isRecord(value) || value.version !== SEND_QUEUE_VERSION || !Array.isArray(value.pending)) return false;
  if (!value.pending.every((item) => isItem(item, attachmentGuard))) return false;
  if (value.blocked !== null && !isBlock(value.blocked)) return false;

  const inFlight = value.inFlight;
  let inFlightItemId: string | null = null;
  if (inFlight !== null) {
    if (
      !isRecord(inFlight) ||
      !isItem(inFlight.item, attachmentGuard) ||
      typeof inFlight.phase !== "string" ||
      !PHASES.has(inFlight.phase as InFlightPhase) ||
      !isFiniteNumber(inFlight.startedAt) ||
      (inFlight.baselineSeq !== undefined && !isFiniteNumber(inFlight.baselineSeq))
    ) {
      return false;
    }
    inFlightItemId = inFlight.item.id;
  }

  const ids = value.pending.map((item) => item.id);
  if (new Set(ids).size !== ids.length) return false;
  return inFlightItemId === null || !ids.includes(inFlightItemId);
}

export function assertSendQueueLane<A>(lane: SendQueueLane<A>): void {
  if (!isSendQueueLane(lane)) throw new Error("Invalid send queue lane");
}

export function emptySendQueueLane<A>(): SendQueueLane<A> {
  return { version: SEND_QUEUE_VERSION, pending: [], inFlight: null, blocked: null };
}

let fallbackIdSequence = 0;

export function createSendQueueId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  fallbackIdSequence += 1;
  return `sq-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createSendQueueItem<A>(
  content: string,
  attachments: A[],
  options: { id?: string; createdAt?: number } = {},
): SendQueueItem<A> {
  const item = {
    id: options.id ?? createSendQueueId(),
    content,
    attachments: [...attachments],
    createdAt: options.createdAt ?? Date.now(),
  };
  if (!isItem(item, (() => true) as unknown as AttachmentGuard<A>)) throw new Error("Invalid send queue item");
  return item;
}

/** 纯追加；重复 ID 被拒绝，原 lane 保持不变。 */
export function enqueue<A>(lane: SendQueueLane<A>, item: SendQueueItem<A>): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (!isItem(item, (() => true) as unknown as AttachmentGuard<A>)) throw new Error("Invalid send queue item");
  if (lane.pending.some((entry) => entry.id === item.id) || lane.inFlight?.item.id === item.id) return lane;
  return { ...lane, pending: [...lane.pending, item] };
}

/** 只允许删除 pending，发送中项不会被 remove 误删。 */
export function remove<A>(lane: SendQueueLane<A>, itemId: string): SendQueueLane<A> {
  assertSendQueueLane(lane);
  const index = lane.pending.findIndex((item) => item.id === itemId);
  if (index < 0) return lane;
  return {
    ...lane,
    pending: [...lane.pending.slice(0, index), ...lane.pending.slice(index + 1)],
    blocked: lane.blocked?.itemId === itemId ? null : lane.blocked,
  };
}

/** 将 item 插到 beforeId 之前；beforeId=null 表示末尾。非法 ID 不改变队列。 */
export function reorderBefore<A>(
  lane: SendQueueLane<A>,
  itemId: string,
  beforeId: string | null,
): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (itemId === beforeId) return lane;
  const blockedItemId = lane.blocked?.itemId;
  if (blockedItemId && (itemId === blockedItemId || beforeId === blockedItemId)) return lane;
  const sourceIndex = lane.pending.findIndex((item) => item.id === itemId);
  if (sourceIndex < 0 || (beforeId !== null && !lane.pending.some((item) => item.id === beforeId))) return lane;
  const next = lane.pending.filter((item) => item.id !== itemId);
  const destination = beforeId === null ? next.length : next.findIndex((item) => item.id === beforeId);
  const item = lane.pending[sourceIndex];
  if (!item) return lane;
  next.splice(destination, 0, item);
  if (next.every((entry, index) => entry === lane.pending[index])) return lane;
  return { ...lane, pending: next };
}

/** 仅在未阻塞且无 in-flight 时原子领取 pending[0]。 */
export function claimHead<A>(lane: SendQueueLane<A>, metadata: ClaimMetadata = {}): SendQueueLane<A> {
  assertSendQueueLane(lane);
  const head = lane.pending[0];
  if (!head || lane.inFlight !== null || lane.blocked !== null) return lane;
  const inFlight: SendQueueInFlight<A> = {
    item: head,
    phase: metadata.phase ?? "dispatching",
    startedAt: metadata.startedAt ?? Date.now(),
    ...(metadata.baselineSeq === undefined ? {} : { baselineSeq: metadata.baselineSeq }),
  };
  return { ...lane, pending: lane.pending.slice(1), inFlight };
}

export function markReceipt<A>(lane: SendQueueLane<A>, itemId: string): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (
    lane.inFlight?.item.id !== itemId ||
    (lane.inFlight.phase !== "dispatching" && lane.inFlight.phase !== "awaiting-receipt")
  ) {
    return lane;
  }
  return { ...lane, inFlight: { ...lane.inFlight, phase: "awaiting-turn-end" } };
}

/** 只有已确认开轮的消息可以在对应轮结束时完成。 */
export function completeTurn<A>(lane: SendQueueLane<A>, itemId: string): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (lane.inFlight?.item.id !== itemId || lane.inFlight.phase !== "awaiting-turn-end") return lane;
  return { ...lane, inFlight: null };
}

const defaultRejectedBlock = (): SendQueueBlock => ({
  code: "send-rejected",
  message: "Message was not accepted by the transport",
  at: Date.now(),
});

/** 明确未投递：原项以原 ID 回到队首并阻塞，后续项不能越过。 */
export function nackHead<A>(
  lane: SendQueueLane<A>,
  itemId: string,
  reason: SendQueueBlock = defaultRejectedBlock(),
): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (
    lane.inFlight?.item.id !== itemId ||
    (lane.inFlight.phase !== "dispatching" && lane.inFlight.phase !== "awaiting-receipt")
  ) {
    return lane;
  }
  return {
    ...lane,
    pending: [lane.inFlight.item, ...lane.pending],
    inFlight: null,
    blocked: { ...reason, itemId },
  };
}

const makesDeliveryUncertain = (code: SendQueueBlockCode) =>
  code === "receipt-unknown" || code === "transport-changed" || code === "unauthorized";

/** 暂停 lane；会令投递结果无法确认的原因同时把 in-flight 标成 uncertain。 */
export function block<A>(lane: SendQueueLane<A>, reason: SendQueueBlock): SendQueueLane<A> {
  assertSendQueueLane(lane);
  const inFlight =
    lane.inFlight && makesDeliveryUncertain(reason.code)
      ? { ...lane.inFlight, phase: "uncertain" as const }
      : lane.inFlight;
  if (lane.blocked === reason && inFlight === lane.inFlight) return lane;
  return { ...lane, inFlight, blocked: reason };
}

export function markUncertain<A>(
  lane: SendQueueLane<A>,
  message = "Delivery could not be confirmed",
  at = Date.now(),
): SendQueueLane<A> {
  if (lane.inFlight === null) return block(lane, { code: "receipt-unknown", message, at });
  return block(lane, { code: "receipt-unknown", message, at });
}

/** 用户确认重试：uncertain 原项回队首；普通 blocked 只解除暂停。 */
export function confirmResume<A>(lane: SendQueueLane<A>): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (lane.inFlight?.phase === "uncertain") {
    return { ...lane, pending: [lane.inFlight.item, ...lane.pending], inFlight: null, blocked: null };
  }
  if (lane.blocked === null) return lane;
  return { ...lane, blocked: null };
}

/** 用户确认该不确定项不应重试。 */
export function discardUncertain<A>(lane: SendQueueLane<A>, itemId: string): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (lane.inFlight?.phase !== "uncertain" || lane.inFlight.item.id !== itemId) return lane;
  return { ...lane, inFlight: null, blocked: null };
}

/** 磁盘恢复规则：不能证明仍在运行的在途项一律暂停，绝不自动重发。 */
export function recoverLaneAfterRestart<A>(
  lane: SendQueueLane<A>,
  options: RestoreOptions = {},
): SendQueueLane<A> {
  assertSendQueueLane(lane);
  if (lane.inFlight === null) return lane;
  if (lane.inFlight.phase === "awaiting-turn-end" && options.awaitingTurnRunning === true) return lane;
  if (lane.inFlight.phase === "uncertain" && lane.blocked !== null) return lane;
  return {
    ...lane,
    inFlight: { ...lane.inFlight, phase: "uncertain" },
    blocked: {
      code: "receipt-unknown",
      message: "Delivery state is unknown after restart",
      at: Date.now(),
    },
  };
}

export function isSendQueueEmpty<A>(lane: SendQueueLane<A>): boolean {
  return lane.pending.length === 0 && lane.inFlight === null;
}

function requireKeyPart(value: string, label: string): string {
  if (!hasText(value)) throw new Error(`${label} must not be empty`);
  return encodeURIComponent(value);
}

export function localSendQueueKey(sessionId: string): string {
  return `${STORAGE_PREFIX}.local.${requireKeyPart(sessionId, "sessionId")}`;
}

export function cloudSendQueueKey(accountScope: string, taskId: string): string {
  return `${STORAGE_PREFIX}.cloud.${requireKeyPart(accountScope, "accountScope")}.${requireKeyPart(taskId, "taskId")}`;
}

export function cloudSendQueueIndexKey(accountScope: string): string {
  return `${STORAGE_PREFIX}.cloud.index.${requireKeyPart(accountScope, "accountScope")}`;
}

export function localSendQueueTarget(sessionId: string): LocalSendQueueTarget {
  localSendQueueKey(sessionId);
  return { scope: "local", sessionId };
}

export function cloudSendQueueTarget(accountScope: string, taskId: string): CloudSendQueueTarget {
  cloudSendQueueKey(accountScope, taskId);
  return { scope: "cloud", accountScope, taskId };
}

export function sendQueueTargetKey(target: SendQueueTarget): string {
  return target.scope === "local"
    ? localSendQueueKey(target.sessionId)
    : cloudSendQueueKey(target.accountScope, target.taskId);
}

function normalizeEndpoint(baseUrl: string | null | undefined, host: string | null | undefined): string | null {
  const rawBase = baseUrl?.trim();
  if (rawBase) {
    try {
      const url = new URL(rawBase);
      const path = url.pathname.replace(/\/+$/, "");
      return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`;
    } catch {
      return rawBase.replace(/\/+$/, "").toLowerCase();
    }
  }
  const rawHost = host?.trim().replace(/\/+$/, "").toLowerCase();
  return rawHost || null;
}

/** 稳定云账号作用域；未登录或缺稳定 user.id 时明确返回 null，禁止历史自动恢复。 */
export function stableCloudAccountScope(identity: CloudAccountIdentity | null | undefined): string | null {
  if (!identity?.logged_in) return null;
  const userId = identity.user?.id?.trim();
  const endpoint = normalizeEndpoint(identity.base_url, identity.host);
  if (!userId || !endpoint) return null;
  return `${endpoint}|${userId}`;
}

/** 便于调用方按设计术语使用。 */
export const accountScopeOf = stableCloudAccountScope;

interface CacheEntry {
  lane: SendQueueLane<unknown>;
  persistence: SendQueuePersistenceState;
  /** 未知版本必须保留在磁盘，普通写操作不得覆盖。 */
  writeProtected: boolean;
}

const laneCache = new Map<string, CacheEntry>();
const indexCache = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();
const laneListeners = new Map<string, Set<() => void>>();
const indexListeners = new Map<string, Set<() => void>>();

function storageOrError(): { storage: Storage | null; error: string | null } {
  try {
    if (typeof localStorage === "undefined") return { storage: null, error: "localStorage is unavailable" };
    return { storage: localStorage, error: null };
  } catch (error) {
    return { storage: null, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitLane(key: string): void {
  for (const listener of listeners) listener();
  for (const listener of laneListeners.get(key) ?? []) listener();
}

function emitIndex(accountScope: string): void {
  for (const listener of listeners) listener();
  for (const listener of indexListeners.get(accountScope) ?? []) listener();
}

export function subscribeSendQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeSendQueueLane(target: SendQueueTarget, listener: () => void): () => void {
  const key = sendQueueTargetKey(target);
  const group = laneListeners.get(key) ?? new Set<() => void>();
  group.add(listener);
  laneListeners.set(key, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) laneListeners.delete(key);
  };
}

export function subscribeCloudQueueIndex(accountScope: string, listener: () => void): () => void {
  requireKeyPart(accountScope, "accountScope");
  const group = indexListeners.get(accountScope) ?? new Set<() => void>();
  group.add(listener);
  indexListeners.set(accountScope, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) indexListeners.delete(accountScope);
  };
}

function attachmentGuardForTarget(target: SendQueueTarget): AttachmentGuard<unknown> {
  return target.scope === "local" ? isLocalQueueAttachment : isCloudQueueAttachment;
}

function loadEntry<A>(target: SendQueueTarget, options: SendQueueReadOptions<A>): CacheEntry {
  const key = sendQueueTargetKey(target);
  const available = storageOrError();
  if (!available.storage) {
    return {
      lane: emptySendQueueLane(),
      persistence: { ok: false, error: available.error },
      writeProtected: false,
    };
  }

  let raw: string | null;
  try {
    raw = available.storage.getItem(key);
  } catch (error) {
    return {
      lane: emptySendQueueLane(),
      persistence: { ok: false, error: errorMessage(error) },
      writeProtected: false,
    };
  }
  if (raw === null) {
    return { lane: emptySendQueueLane(), persistence: { ok: true, error: null }, writeProtected: false };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && parsed.version !== SEND_QUEUE_VERSION) {
      return {
        lane: emptySendQueueLane(),
        persistence: { ok: false, error: "Unsupported send queue version" },
        writeProtected: true,
      };
    }
    const guard = options.attachmentGuard ?? (attachmentGuardForTarget(target) as AttachmentGuard<A>);
    if (!isSendQueueLane(parsed, guard)) {
      return {
        lane: emptySendQueueLane(),
        persistence: { ok: false, error: "Corrupt send queue data" },
        writeProtected: false,
      };
    }
    return {
      lane: recoverLaneAfterRestart(parsed, options),
      persistence: { ok: true, error: null },
      writeProtected: false,
    };
  } catch (error) {
    return {
      lane: emptySendQueueLane(),
      persistence: { ok: false, error: `Corrupt send queue data: ${errorMessage(error)}` },
      writeProtected: false,
    };
  }
}

export function readSendQueueLane<A>(
  target: SendQueueTarget,
  options: SendQueueReadOptions<A> = {},
): SendQueueLane<A> {
  const key = sendQueueTargetKey(target);
  let entry = laneCache.get(key);
  if (!entry) {
    entry = loadEntry(target, options);
    laneCache.set(key, entry);
  }
  return entry.lane as SendQueueLane<A>;
}

/** useSyncExternalStore 的 getSnapshot；同一状态始终返回同一对象引用。 */
export const getSendQueueLaneSnapshot = readSendQueueLane;

function loadCloudIndex(accountScope: string): readonly string[] {
  const available = storageOrError();
  if (!available.storage) return [];
  try {
    const raw = available.storage.getItem(cloudSendQueueIndexKey(accountScope));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(hasText)) return [];
    return [...new Set(parsed)];
  } catch {
    return [];
  }
}

export function getCloudQueueIndexSnapshot(accountScope: string): readonly string[] {
  requireKeyPart(accountScope, "accountScope");
  let index = indexCache.get(accountScope);
  if (!index) {
    index = loadCloudIndex(accountScope);
    indexCache.set(accountScope, index);
  }
  return index;
}

export const readCloudQueueIndex = getCloudQueueIndexSnapshot;

function setCloudIndexMemory(accountScope: string, taskId: string, nonEmpty: boolean): readonly string[] {
  const previous = getCloudQueueIndexSnapshot(accountScope);
  const next = nonEmpty
    ? previous.includes(taskId)
      ? previous
      : [...previous, taskId]
    : previous.filter((id) => id !== taskId);
  if (next !== previous) {
    indexCache.set(accountScope, next);
    emitIndex(accountScope);
  }
  return next;
}

function persistCloudIndex(accountScope: string, index: readonly string[], storage: Storage): string | null {
  try {
    if (index.length === 0) storage.removeItem(cloudSendQueueIndexKey(accountScope));
    else storage.setItem(cloudSendQueueIndexKey(accountScope), JSON.stringify(index));
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

/**
 * 内存先提交、磁盘后提交。磁盘失败不会回滚内存，result.ok/error 及
 * getSendQueuePersistenceState 可供现有错误条感知；后续写仍会重试。
 */
export function writeSendQueueLane<A>(target: SendQueueTarget, lane: SendQueueLane<A>): SendQueueWriteResult<A> {
  assertSendQueueLane(lane);
  const key = sendQueueTargetKey(target);
  const previous = laneCache.get(key);
  const entry: CacheEntry = {
    lane,
    persistence: { ok: true, error: null },
    writeProtected: previous?.writeProtected ?? false,
  };
  laneCache.set(key, entry);
  emitLane(key);

  if (target.scope === "cloud") setCloudIndexMemory(target.accountScope, target.taskId, !isSendQueueEmpty(lane));

  if (entry.writeProtected) {
    entry.persistence = { ok: false, error: "Unsupported send queue version; existing data was not overwritten" };
    return { lane, ...entry.persistence };
  }

  const available = storageOrError();
  if (!available.storage) {
    entry.persistence = { ok: false, error: available.error };
    return { lane, ...entry.persistence };
  }

  try {
    available.storage.setItem(key, JSON.stringify(lane));
  } catch (error) {
    entry.persistence = { ok: false, error: errorMessage(error) };
    return { lane, ...entry.persistence };
  }

  if (target.scope === "cloud") {
    const index = getCloudQueueIndexSnapshot(target.accountScope);
    const indexError = persistCloudIndex(target.accountScope, index, available.storage);
    if (indexError) {
      entry.persistence = { ok: false, error: indexError };
      return { lane, ...entry.persistence };
    }
  }
  entry.persistence = { ok: true, error: null };
  return { lane, ...entry.persistence };
}

export function updateSendQueueLane<A>(
  target: SendQueueTarget,
  transition: (lane: SendQueueLane<A>) => SendQueueLane<A>,
  options: SendQueueReadOptions<A> = {},
): SendQueueWriteResult<A> {
  const current = readSendQueueLane(target, options);
  const next = transition(current);
  assertSendQueueLane(next);
  if (next === current) {
    const state = getSendQueuePersistenceState(target);
    return { lane: next, ...state };
  }
  return writeSendQueueLane(target, next);
}

export function getSendQueuePersistenceState(target: SendQueueTarget): SendQueuePersistenceState {
  const key = sendQueueTargetKey(target);
  const entry = laneCache.get(key);
  if (entry) return entry.persistence;
  readSendQueueLane(target);
  return laneCache.get(key)?.persistence ?? { ok: false, error: "Queue could not be loaded" };
}

/** 删除成功的 session/task 调用：同时删除 lane，cloud 还会维护非空索引。 */
export function dropSendQueueTarget(target: SendQueueTarget): SendQueueDropResult {
  const key = sendQueueTargetKey(target);
  const available = storageOrError();
  let persistence: SendQueuePersistenceState = { ok: true, error: null };
  try {
    if (available.storage) available.storage.removeItem(key);
  } catch (error) {
    persistence = { ok: false, error: errorMessage(error) };
  }

  // 保留显式空快照，避免同步订阅者在删除通知中从尚未删除成功的磁盘数据
  // 重新填充缓存。目标已经被业务层删除时，内存中绝不能继续暴露旧消息。
  laneCache.set(key, {
    lane: emptySendQueueLane(),
    persistence,
    writeProtected: false,
  });
  if (target.scope === "cloud") setCloudIndexMemory(target.accountScope, target.taskId, false);

  if (!available.storage) {
    persistence = { ok: false, error: available.error };
  } else if (target.scope === "cloud") {
    const indexError = persistCloudIndex(
      target.accountScope,
      getCloudQueueIndexSnapshot(target.accountScope),
      available.storage,
    );
    if (indexError) persistence = { ok: false, error: indexError };
  }
  const entry = laneCache.get(key);
  if (entry) entry.persistence = persistence;
  emitLane(key);
  return { dropped: true, ...persistence };
}

export const dropTarget = dropSendQueueTarget;
export const dropLocalSendQueue = (sessionId: string) => dropSendQueueTarget(localSendQueueTarget(sessionId));
export const dropCloudSendQueue = (accountScope: string, taskId: string) =>
  dropSendQueueTarget(cloudSendQueueTarget(accountScope, taskId));

/** transport/account 失效时暂停旧命名空间；不删除，也绝不自动续发。 */
export function invalidateCloudAccountQueues(
  accountScope: string,
  reason: SendQueueBlock = {
    code: "transport-changed",
    message: "Cloud transport changed; confirm before resuming",
    at: Date.now(),
  },
): SendQueueWriteResult<CloudQueueAttachment>[] {
  return getCloudQueueIndexSnapshot(accountScope).map((taskId) => {
    const target = cloudSendQueueTarget(accountScope, taskId);
    return updateSendQueueLane<CloudQueueAttachment>(target, (lane) => block(lane, reason));
  });
}

/** 仅供相邻单元测试模拟应用重启；不触碰 localStorage。 */
export function resetSendQueueMemoryForTests(): void {
  laneCache.clear();
  indexCache.clear();
  fallbackIdSequence = 0;
}
