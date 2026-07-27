// Linux 壳的文件拖拽通道:WebKitGTK 在 wry 窗口里的 HTML5 拖拽拿不到 File
// 对象(上游缺陷),壳侧仅在 Linux 保留了 Tauri 原生拖放处理器(main.rs 的
// create_main_window),拖拽以 tauri://drag-* 事件送达、载荷是文件路径;本
// hook 把路径经壳命令读回字节还原成 File,交给与 DOM 拖拽同一条附件管线。
// mac/Windows 壳禁用了原生处理器走 DOM 事件,这里的监听永不触发,无副作用。
import { useEffect, useRef } from "react";
import { invoke, listen } from "./ipc";

interface DroppedFile {
  name: string;
  mediaType: string;
  data: string; // base64
}

function toFile(r: DroppedFile, path: string): File {
  const bin = atob(r.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const name = r.name || path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";
  return new File([bytes], name, { type: r.mediaType });
}

/** 订阅壳的原生文件拖放事件。enabled=false 时不响应(如云端任务模式);
 * 监听始终挂着,由回调侧判断,避免 effect 依赖变化时错过拖拽中的事件。 */
export function useNativeFileDrop(opts: {
  enabled: boolean;
  onDragging: (dragging: boolean) => void;
  onFiles: (files: File[]) => void;
  onError: (msg: string) => void;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    const un = [
      listen("tauri://drag-enter", () => {
        if (ref.current.enabled) ref.current.onDragging(true);
      }),
      listen("tauri://drag-leave", () => ref.current.onDragging(false)),
      listen("tauri://drag-drop", (payload) => {
        ref.current.onDragging(false);
        if (!ref.current.enabled) return;
        const paths = (payload as { paths?: string[] } | null)?.paths ?? [];
        if (!paths.length) return;
        void (async () => {
          const files: File[] = [];
          for (const p of paths) {
            try {
              const r = await invoke<DroppedFile>("read_dropped_file", { path: p });
              files.push(toFile(r, p));
            } catch (e) {
              ref.current.onError(e instanceof Error ? e.message : String(e));
            }
          }
          if (files.length) ref.current.onFiles(files);
        })();
      }),
    ];
    return () => un.forEach((f) => f());
  }, []);
}
