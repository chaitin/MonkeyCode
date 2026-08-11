// 待办域 API:todos_load / todos_save(壳侧 config_dir/todos.json,全量替换
// 语义——与 Agent 的 TodoWrite 同口径,UI 是唯一写者,不做逐条 patch)。
// 类型字段名 = 壳侧 serde 序列化的线上形状(契约,别改名)。
//
// 错误约定与 sessions.ts 同口径:浏览器模式列表回空、变更抛错;壳内失败
// 一律抛给调用方外显(useTodos 把原因交给 App 的角落提示栈)。
import { inDesktopShell, invoke } from "./ipc";

export type TodoStatus = "pending" | "done";
/** 派发去向:local/chat = 壳会话表里的会话;cloud = MonkeyCode 云端任务。 */
export type TodoDispatchKind = "local" | "chat" | "cloud";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  /** 已派发成任务时的去向与目标 id(未派发则两者都缺席) */
  dispatched_kind?: TodoDispatchKind;
  dispatched_id?: string;
  /** 秒精度 UTC(与壳 updated_at 同格式,见 config.rs::ms_to_rfc3339) */
  created_at: string;
  updated_at: string;
}

export function todosLoad(): Promise<TodoItem[]> {
  if (!inDesktopShell()) return Promise.resolve([]);
  return invoke<TodoItem[]>("todos_load");
}

export function todosSave(items: TodoItem[]): Promise<void> {
  return invoke<void>("todos_save", { items }).then(() => {});
}
