// 新建任务页的未提交草稿暂存(模块级、内存态,与 composer 的 stash.ts 同款思路)。
// 新建页(NewTaskModal)是格内内嵌视图:点侧栏别的会话、装载/换位都会让
// SplitView 卸载它,组件 state 随之全丢——用户写了一半的首条消息、拖进来的
// 附件、选好的目录/模型/技能,点回「新建」就是一张空表(2026-09-04 报障)。
// 口径:关闭/卸载即留档,创建成功才清;取消/Esc/切走一律保留,与 Esc 分层那次
// (b6bda87b)的判断一致——一下误操作不能把整篇草稿带走,要丢用户自己清空。
// 只留一份、不按格 key:格号随分屏增删重排并不稳定,同时开两个新建页极罕见,
// 后关的覆盖先关的。File 无法落盘,故不进 localStorage;重启即空,与 composer 同。
import type { CloudProject } from "@/lib/ipc/cloudtasks";
import type { SessionKind } from "@/lib/ipc/sessions";

/** 暂存的附件:File 本体 + 展示名 + 图片预览 URL(非图片/占位 File 无);
 *  上传发生在建会话之后。
 *
 *  `name` 单独存一份而不是各处读 `file.name`:占位 File 与剪贴板截图都可能
 *  空名(uploads.ts::pathBackedFile 头注、壳 uploads.rs 也为此备了落盘兜底),
 *  五处渲染各写一遍 `|| 兜底` 迟早漏一处——加进来时算一次,渲染只管用。 */
export interface StagedAtt {
  file: File;
  name: string;
  preview?: string;
}

export interface NewTaskDraft {
  kind: SessionKind | "cloud";
  text: string;
  atts: StagedAtt[];
  /** 用户明确改过目录才带值;null = 没碰过,重开仍走「最近目录首项」预填 */
  dir: string | null;
  model: string;
  thinkOverride: string | null;
  enabledSkills: string[] | null;
}

/** 云端页签(NewCloudTask)自己的编辑面;停在哪个页签记在 NewTaskDraft.kind。 */
export interface CloudTaskDraft {
  content: string;
  project: CloudProject | null;
  repoUrl: string;
}

let localDraft: NewTaskDraft | null = null;
let cloudDraft: CloudTaskDraft | null = null;

/** 释放 gone 里不再被任何 live 列表引用的预览 objectURL。同一批 URL 会在组件
 *  state 与档之间共享,只看"还有谁在用",不按归属撤——撤早了恢复出来是裂图。 */
export function revokeStalePreviews(gone: readonly StagedAtt[], ...live: readonly (readonly StagedAtt[])[]): void {
  const keep = new Set<string>();
  for (const list of live) for (const a of list) if (a.preview) keep.add(a.preview);
  for (const a of gone) if (a.preview && !keep.has(a.preview)) URL.revokeObjectURL(a.preview);
}

export function readNewTaskDraft(): NewTaskDraft | null {
  return localDraft;
}

/** 空档不占条目:正文/附件都空、也不是"停在已写描述的云端页签",等同清档。 */
export function saveNewTaskDraft(next: NewTaskDraft): void {
  const worth = next.text.trim() !== "" || next.atts.length > 0 || (next.kind === "cloud" && !!cloudDraft?.content.trim());
  revokeStalePreviews(localDraft?.atts ?? [], next.atts);
  localDraft = worth ? { ...next, atts: [...next.atts], enabledSkills: next.enabledSkills ? [...next.enabledSkills] : null } : null;
}

export function clearNewTaskDraft(): void {
  revokeStalePreviews(localDraft?.atts ?? []);
  localDraft = null;
}

export function readCloudTaskDraft(): CloudTaskDraft | null {
  return cloudDraft;
}

/** 描述为空即空档:只带着预选项目/仓库地址不值得下次自动回填。 */
export function saveCloudTaskDraft(next: CloudTaskDraft): void {
  cloudDraft = next.content.trim() ? { ...next } : null;
}

export function clearCloudTaskDraft(): void {
  cloudDraft = null;
}

/** 测试隔离:模块级状态会跨用例串档(dom project 的 setup 每例后调)。不撤 URL:
 *  用例自己建的 File/objectURL 归用例管。 */
export function resetNewTaskDraftsForTests(): void {
  localDraft = null;
  cloudDraft = null;
}
