// 待办清单的域状态(App 持有一份,TodoView 消费):挂载时整份拉取,变更
// 乐观更新 + 全量落盘(与壳 todos_save 的全量替换语义一致)。落盘失败
// **保留乐观状态**并把原因交给 onError 外显——回滚会把用户刚敲的字当场
// 吞掉,比「重启后丢一次改动」更糟;下一次任何变更都会带着完整快照重试。
import { useEffect, useRef, useState } from "react";

import { todosLoad, todosSave, type TodoDispatchKind, type TodoItem } from "@/lib/ipc/todos";

/** 壳侧 updated_at 同格式(config.rs::ms_to_rfc3339):秒精度 UTC。 */
const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export interface TodoOps {
  todos: TodoItem[];
  add: (content: string) => void;
  /** 编辑正文;空串视为无效提交,调用方在 UI 层拦下 */
  edit: (id: string, content: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  /** 派发落定(新建任务视图创建成功后回填去向) */
  markDispatched: (id: string, kind: TodoDispatchKind, targetId: string) => void;
}

export function useTodos(onError: (kind: "load" | "save", reason: string) => void): TodoOps {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // 回调经 ref 读最新闭包:挂载期 effect 只跑一次,不因 onError 身份变化重拉
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    todosLoad().then(
      (list) => {
        if (alive) setTodos(list);
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

  const mutate = (fn: (prev: TodoItem[]) => TodoItem[]) => {
    setTodos((prev) => {
      const next = fn(prev);
      void todosSave(next).catch((e: unknown) =>
        onErrorRef.current("save", e instanceof Error ? e.message : String(e)),
      );
      return next;
    });
  };

  const patch = (id: string, changes: Partial<TodoItem>) =>
    mutate((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes, updated_at: nowStamp() } : item)),
    );

  return {
    todos,
    add: (content) => {
      const stamp = nowStamp();
      mutate((prev) => [
        ...prev,
        { id: crypto.randomUUID(), content, status: "pending", created_at: stamp, updated_at: stamp },
      ]);
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
    remove: (id) => mutate((prev) => prev.filter((item) => item.id !== id)),
    markDispatched: (id, kind, targetId) => patch(id, { dispatched_kind: kind, dispatched_id: targetId }),
  };
}
