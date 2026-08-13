// 待办域 API:todos_load / todos_save(壳侧 config_dir/todos.json,全量替换
// 语义——与 Agent 的 TodoWrite 同口径,UI 是唯一写者,不做逐条 patch)。
// 类型字段名 = 壳侧 serde 序列化的线上形状(契约,别改名)。
//
// 图片附件走 todo_upload_* 命令面(config_dir/todo-uploads,平铺一层,条目
// 里只存裸文件名):开档/直拷是待办自己的命令,块推送与收尾共用会话通道的
// upload_chunk/finish/abort(同一张壳侧句柄表,见 uploads.ts::streamToHandle)。
//
// 错误约定与 sessions.ts 同口径:浏览器模式列表回空、变更抛错;壳内失败
// 一律抛给调用方外显(useTodos 把原因交给 App 的角落提示栈)。
import { inDesktopShell, invoke } from "./ipc";
import { nativePathOf, streamToHandle } from "./uploads";

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
  /** 图片附件:todo-uploads 目录内的裸文件名(生命周期归 useTodos) */
  images?: string[];
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

/** 上传一张待办图片,返回落盘的裸文件名。path-backed 占位 File(系统对话框
 * 选图,只有路径)走壳侧直拷;有内容的(粘贴的截图)走分块。 */
export async function todoUploadFile(f: File): Promise<string> {
  const native = nativePathOf(f);
  if (native) {
    const { path } = await invoke<{ path: string }>("todo_upload_path", { src: native });
    return path;
  }
  const { handle } = await invoke<{ handle: number }>("todo_upload_begin", {
    name: f.name,
    mediaType: f.type,
  });
  return (await streamToHandle(handle, f)).path;
}

/** 回读待办图片为 data URL(壳校验路径钉在 todo-uploads 内、仅常见图片)。 */
export function todoUploadURL(name: string): Promise<string> {
  return invoke<string>("todo_upload_read", { path: name });
}

/** 删除一张待办图片(移除图/删待办时的文件清理);文件缺席幂等成功。 */
export function todoUploadDelete(name: string): Promise<void> {
  return invoke<void>("todo_upload_delete", { path: name }).then(() => {});
}

/** 附件目录绝对路径:派发成任务时拼 path-backed File 的源路径用。 */
export function todoUploadsDir(): Promise<string> {
  return invoke<string>("todo_uploads_dir");
}
