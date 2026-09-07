// 云端任务 composer 的未发送草稿暂存(模块级、内存态,与本地 composer 的 stash.ts
// 同款思路)。CloudTaskView 按任务 id 挂 key,切任务整棵重挂,useCloudTask 里的输入
// 正文与已上传附件随组件 state 全丢(2026-09-04 排查新建页草稿丢失时一并发现)。
// 键 = 账号作用域 + 任务 id,与持久化队列 cloudSendQueueTarget 同口径:切号后回来
// 各回各的草稿。已排队/已发送的消息不在这里——它们落在 sendQueue 的持久 lane;
// 上传中的计数是瞬态不入档(在途上传由 attachmentContext 换代作废)。
import type { CloudUploadedAtt } from "@/lib/cloud/upload";

export interface CloudDraftEntry {
  input: string;
  atts: CloudUploadedAtt[];
}

const drafts = new Map<string, CloudDraftEntry>();

function keyOf(accountScope: string, taskId: string): string {
  return JSON.stringify([accountScope, taskId]);
}

export function cloudDraftGet(accountScope: string, taskId: string): CloudDraftEntry | undefined {
  return drafts.get(keyOf(accountScope, taskId));
}

/** 空档不占条目。 */
export function cloudDraftSet(accountScope: string, taskId: string, entry: CloudDraftEntry): void {
  const key = keyOf(accountScope, taskId);
  if (entry.input || entry.atts.length) drafts.set(key, { input: entry.input, atts: [...entry.atts] });
  else drafts.delete(key);
}

/** 任务删除成功后随持久 lane 一起丢弃(App 的 cloud.onDeleted 接线)。 */
export function dropCloudDraft(accountScope: string, taskId: string): void {
  drafts.delete(keyOf(accountScope, taskId));
}

export function resetCloudDraftStashForTests(): void {
  drafts.clear();
}
