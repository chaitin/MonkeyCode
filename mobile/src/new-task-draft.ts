/**
 * 新建任务草稿的内存缓存。
 *
 * 新建任务页在返回首页/任务列表后会被卸载，本地 useState 会丢失用户已输入的内容。
 * 这里用模块级单例在应用会话内缓存草稿，使「返回后再进入新建任务」时能恢复上次输入
 * （对齐网页版的体验）。仅保留应用会话内的导航往返场景，不做持久化落盘。
 */

export interface NewTaskDraft {
  /** 任务描述（主输入框内容） */
  content?: string;
  /** 已选的仓库标识：'' 快速开始 / project.id / MANUAL_REPO_KEY / ZIP_REPO_KEY */
  repoKey?: string;
  /** 手动输入的 Git 仓库地址 */
  manualRepo?: string;
}

let draft: NewTaskDraft = {};

export function getNewTaskDraft(): NewTaskDraft {
  return draft;
}

export function saveNewTaskDraft(next: NewTaskDraft): void {
  draft = { ...draft, ...next };
}

export function clearNewTaskDraft(): void {
  draft = {};
}
