// 待办清单的域状态(App 持有一份,侧栏待办组消费):挂载时整份拉取,变更
// 乐观更新 + 全量落盘(与壳 todos_save 的全量替换语义一致)。落盘失败
// **保留乐观状态**并把原因交给 onError 外显——回滚会把用户刚敲的字当场
// 吞掉,比「重启后丢一次改动」更糟;下一次任何变更都会带着完整快照重试。
//
// 图片附件的生命周期在这一层收口:上传(todoUploadFile)成功才挂进条目;
// 移除图/删条目时逐个 todoUploadDelete 清文件——清理失败只剩无害的孤儿
// 字节,不外显;**上传失败必须外显**(用户刚贴的截图没了是要知道的)。
import { useEffect, useRef, useState } from "react";

import {
  todosLoad,
  todosSave,
  todoUploadDelete,
  todoUploadFile,
  type TodoDispatchKind,
  type TodoItem,
} from "@/lib/ipc/todos";

/** 壳侧 updated_at 同格式(config.rs::ms_to_rfc3339):秒精度 UTC。 */
const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export interface TodoOps {
  todos: TodoItem[];
  /** 添加;images 随建上传,逐张落盘后一次挂上(失败单张外显、其余继续) */
  add: (content: string, images?: File[]) => void;
  /** 编辑正文;空串视为无效提交,调用方在 UI 层拦下 */
  edit: (id: string, content: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  /** 拖拽排序:把 id 挪到 beforeId 之前(null = 挪到末尾)。不动 updated_at
   *  ——排序是清单的事,不是条目的变更 */
  reorder: (id: string, beforeId: string | null) => void;
  /** 给已有条目追加图片(详情弹窗/输入态粘贴) */
  addImages: (id: string, files: File[]) => void;
  /** 移除一张图:列表即时更新,文件清理跟队 */
  removeImage: (id: string, name: string) => void;
  /** 派发落定(新建任务视图创建成功后回填去向) */
  markDispatched: (id: string, kind: TodoDispatchKind, targetId: string) => void;
}

export function useTodos(onError: (kind: "load" | "save" | "upload", reason: string) => void): TodoOps {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // 回调经 ref 读最新闭包:挂载期 effect 只跑一次,不因 onError 身份变化重拉
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    todosLoad().then(
      (list) => {
        if (!alive) return;
        // 非数组回包按契约漂移外显,不进状态:清单自 2026-08-12 起常驻侧栏
        // 渲染路径,坏形状直接 .filter 会把整栏炸成白屏
        if (Array.isArray(list)) setTodos(list);
        else onErrorRef.current("load", "todos_load 返回了非列表响应");
      },
      // 加载失败保留空表但**必须外显**:todos.json 损坏时静默空表会被下一次
      // 变更的全量落盘覆盖,用户的清单就真没了
      (e: unknown) => {
        if (alive) onErrorRef.current("load", e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const persist = (next: TodoItem[]) =>
    void todosSave(next).catch((e: unknown) =>
      onErrorRef.current("save", e instanceof Error ? e.message : String(e)),
    );

  const mutate = (fn: (prev: TodoItem[]) => TodoItem[]) => {
    setTodos((prev) => {
      const next = fn(prev);
      persist(next);
      return next;
    });
  };

  const patch = (id: string, changes: Partial<TodoItem>) =>
    mutate((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes, updated_at: nowStamp() } : item)),
    );

  /** 图片文件清理:幂等、失败不外显(残留字节无害,不值一条打扰)。 */
  const deleteFiles = (names: string[]) => {
    for (const n of names) void todoUploadDelete(n).catch(() => {});
  };

  /** 逐张上传后一次挂上。挂载前条目可能已被删(上传中用户删了行):此时
   * 把刚落盘的文件清掉,不落孤儿,也不再落盘。 */
  const attachImages = async (id: string, files: File[]) => {
    const names: string[] = [];
    for (const f of files) {
      try {
        names.push(await todoUploadFile(f));
      } catch (e) {
        onErrorRef.current("upload", e instanceof Error ? e.message : String(e));
      }
    }
    if (!names.length) return;
    setTodos((prev) => {
      if (!prev.some((item) => item.id === id)) {
        deleteFiles(names);
        return prev;
      }
      const next = prev.map((item) =>
        item.id === id
          ? { ...item, images: [...(item.images ?? []), ...names], updated_at: nowStamp() }
          : item,
      );
      persist(next);
      return next;
    });
  };

  return {
    todos,
    add: (content, images) => {
      const stamp = nowStamp();
      const id = crypto.randomUUID();
      mutate((prev) => [
        ...prev,
        { id, content, status: "pending", created_at: stamp, updated_at: stamp },
      ]);
      if (images?.length) void attachImages(id, images);
    },
    edit: (id, content) => patch(id, { content }),
    toggle: (id) =>
      mutate((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: item.status === "done" ? "pending" : "done", updated_at: nowStamp() }
            : item,
        ),
      ),
    remove: (id) =>
      mutate((prev) => {
        deleteFiles(prev.find((item) => item.id === id)?.images ?? []);
        return prev.filter((item) => item.id !== id);
      }),
    reorder: (id, beforeId) =>
      setTodos((prev) => {
        const item = prev.find((i) => i.id === id);
        if (!item || id === beforeId) return prev;
        const rest = prev.filter((i) => i.id !== id);
        const at = beforeId ? rest.findIndex((i) => i.id === beforeId) : rest.length;
        if (beforeId && at < 0) return prev; // 目标已被删:放弃这次落点
        const next = [...rest.slice(0, at), item, ...rest.slice(at)];
        // 原位落点不落盘(UI 侧另有 willMove 预判,这里兜底)
        if (next.every((x, i) => x === prev[i])) return prev;
        persist(next);
        return next;
      }),
    addImages: (id, files) => void attachImages(id, files),
    removeImage: (id, name) => {
      mutate((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                images: (item.images ?? []).filter((n) => n !== name),
                updated_at: nowStamp(),
              }
            : item,
        ),
      );
      deleteFiles([name]);
    },
    markDispatched: (id, kind, targetId) => patch(id, { dispatched_kind: kind, dispatched_id: targetId }),
  };
}
