// Linux 壳的文件拖拽通道:WebKitGTK 在 wry 窗口里的 HTML5 拖拽拿不到 File
// 对象(上游缺陷),壳侧仅在 Linux 保留了 Tauri 原生拖放处理器(main.rs 的
// create_main_window),拖拽以 tauri://drag-* 事件送达、载荷是文件路径。
// 默认(本地会话)只 stat 元数据造 path-backed 占位 File 进附件管线,内容
// 由壳按路径直拷(uploads.ts uploadFilePath),大小不设限;wantContent 的
// 调用方(云端任务要把字节上行对象存储)仍经壳读回内容还原 File,保留
// 整包 20MB 上限。mac/Windows 壳禁用了原生处理器走 DOM 事件,这里的监听
// 永不触发,无副作用。
import { useEffect, useRef } from "react";
import { invoke, listen } from "./ipc";
import { pathBackedFile } from "./uploads";

interface DroppedFile {
  name: string;
  mediaType: string;
  data: string; // base64
}

interface DroppedStat {
  name: string;
  mediaType: string;
  size: number;
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
  /** 需要文件内容本体(云端上行对象存储);缺省只造 path-backed 占位 File */
  wantContent?: boolean;
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
              if (ref.current.wantContent) {
                const r = await invoke<DroppedFile>("read_dropped_file", { path: p });
                files.push(toFile(r, p));
              } else {
                const st = await invoke<DroppedStat>("stat_dropped_file", { path: p });
                const name = st.name || p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "file";
                files.push(pathBackedFile(p, name, st.mediaType));
              }
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
