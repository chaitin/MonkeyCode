import { afterEach, describe, expect, it, vi } from "vitest";

import {
  b64OfBytes,
  isImagePath,
  nativePathOf,
  onNativeFileDrop,
  pathBackedFile,
  pickAttachmentPaths,
  uploadFilePath,
  uploadFileStream,
  uploadFileURL,
} from "./uploads";

afterEach(() => vi.unstubAllGlobals());

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function stubShell(handler?: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          const r = handler?.(cmd, args);
          if (r instanceof Promise) return r;
          if (cmd === "upload_begin") return Promise.resolve({ handle: 7 });
          if (cmd === "upload_finish") return Promise.resolve({ path: ".monkeycode/uploads/a.bin" });
          return Promise.resolve(r ?? null);
        },
      },
    },
  });
  return calls;
}

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe("uploadFileStream 分块边界", () => {
  it("10 字节按 4 字节分块 → 3 块字节精确重组;begin/finish 契约与进度回调", async () => {
    const calls = stubShell();
    const progress: Array<[number, number]> = [];
    const f = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], "big.bin", {
      type: "application/octet-stream",
    });
    const r = await uploadFileStream("s1", f, {
      chunkBytes: 4,
      onProgress: (sent, total) => progress.push([sent, total]),
    });
    expect(r).toEqual({ path: ".monkeycode/uploads/a.bin" });
    expect(calls[0]).toEqual({
      cmd: "upload_begin",
      args: { id: "s1", name: "big.bin", mediaType: "application/octet-stream" },
    });
    const chunks = calls.filter((c) => c.cmd === "upload_chunk");
    expect(chunks.map((c) => [...decode(c.args?.data as string)])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10],
    ]);
    expect(chunks.every((c) => c.args?.handle === 7)).toBe(true);
    expect(calls.at(-1)).toEqual({ cmd: "upload_finish", args: { handle: 7 } });
    expect(progress).toEqual([
      [4, 10],
      [8, 10],
      [10, 10],
    ]);
  });

  it("整除边界:8 字节 4 一块恰好 2 块,不多发空块", async () => {
    const calls = stubShell();
    const f = new File([new Uint8Array(8)], "a.bin", { type: "" });
    await uploadFileStream("s1", f, { chunkBytes: 4 });
    expect(calls.filter((c) => c.cmd === "upload_chunk")).toHaveLength(2);
  });

  it("空文件:零块直达 finish(壳侧落一个空文件)", async () => {
    const calls = stubShell();
    await uploadFileStream("s1", new File([], "empty.txt", { type: "text/plain" }), { chunkBytes: 4 });
    expect(calls.map((c) => c.cmd)).toEqual(["upload_begin", "upload_finish"]);
  });

  it("某块失败:upload_abort 销档,错误原样上抛,不再 finish", async () => {
    const calls = stubShell((cmd) => {
      if (cmd === "upload_chunk") return Promise.reject(new Error("disk full"));
      return undefined;
    });
    const f = new File([new Uint8Array(6)], "x.bin", { type: "" });
    await expect(uploadFileStream("s1", f, { chunkBytes: 4 })).rejects.toThrow("disk full");
    expect(calls.map((c) => c.cmd)).toEqual(["upload_begin", "upload_chunk", "upload_abort"]);
    expect(calls.at(-1)?.args).toEqual({ handle: 7 });
  });

  it("取消信号:下一块前中止,抛 AbortError 并 upload_abort", async () => {
    const ctl = new AbortController();
    const calls = stubShell((cmd) => {
      if (cmd === "upload_chunk") ctl.abort(); // 第一块落地后用户点了取消
      return undefined;
    });
    const f = new File([new Uint8Array(8)], "x.bin", { type: "" });
    await expect(uploadFileStream("s1", f, { chunkBytes: 4, signal: ctl.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls.filter((c) => c.cmd === "upload_chunk")).toHaveLength(1);
    expect(calls.some((c) => c.cmd === "upload_finish")).toBe(false);
    expect(calls.at(-1)?.cmd).toBe("upload_abort");
  });
});

describe("路径直拷与对话框选择", () => {
  it("uploadFilePath:{id, src} 契约透传", async () => {
    const calls = stubShell((cmd) => (cmd === "upload_file_path" ? { path: ".monkeycode/uploads/数据.csv" } : undefined));
    const r = await uploadFilePath("s1", "/home/u/数据.csv");
    expect(r.path).toBe(".monkeycode/uploads/数据.csv");
    expect(calls[0]).toEqual({ cmd: "upload_file_path", args: { id: "s1", src: "/home/u/数据.csv" } });
  });

  it("uploadFileURL:{id, path} 契约透传,返回 data URL 原样", async () => {
    const calls = stubShell((cmd) => (cmd === "upload_read" ? "data:image/png;base64,AAA" : undefined));
    const r = await uploadFileURL("s1", ".monkeycode/uploads/截图.png");
    expect(r).toBe("data:image/png;base64,AAA");
    expect(calls[0]).toEqual({ cmd: "upload_read", args: { id: "s1", path: ".monkeycode/uploads/截图.png" } });
  });

  it("pickAttachmentPaths:数组/单串/取消(null)/浏览器模式各形态收敛", async () => {
    stubShell((cmd) => (cmd === "plugin:dialog|open" ? ["/a.png", "/b.txt"] : undefined));
    expect(await pickAttachmentPaths("选择附件")).toEqual(["/a.png", "/b.txt"]);

    stubShell((cmd) => (cmd === "plugin:dialog|open" ? "/only.png" : undefined));
    expect(await pickAttachmentPaths()).toEqual(["/only.png"]);

    stubShell(() => null);
    expect(await pickAttachmentPaths()).toEqual([]);

    vi.stubGlobal("window", {});
    expect(await pickAttachmentPaths()).toEqual([]);
  });
});

/** 假壳事件总线:记录 tauri:// 监听并向下投递 payload。 */
function stubDropShell(handler: (cmd: string, args?: Record<string, unknown>) => unknown) {
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  const calls: Call[] = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          return Promise.resolve(handler(cmd, args));
        },
      },
      event: {
        listen: (name: string, cb: (e: { payload: unknown }) => void) => {
          listeners.set(name, cb);
          return Promise.resolve(() => listeners.delete(name));
        },
      },
    },
  });
  return { listeners, calls };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

// Linux 壳原生拖放(WebKitGTK 的 HTML5 拖拽拿不到 File)。两个来源要的东西
// 不一样:本地会话只要路径(壳直拷,大小不设限),云端附件要**字节本体**
// (mc_upload 直传对象存储)。少了 wantContent 这一岔,云端侧拖进来的
// 每个文件都是 0 字节,uploadCloudFile 一律以「是空文件」告吹。
describe("onNativeFileDrop 内容分岔", () => {
  it("enabled 门禁在 stat/read 之前拦截窗口级事件", async () => {
    const { listeners, calls } = stubDropShell(() => ({ name: "a.txt", mediaType: "" }));
    let enabled = false;
    const got: File[][] = [];
    const off = onNativeFileDrop({
      enabled: () => enabled,
      onDragging: () => {},
      onFiles: (files) => got.push(files),
    });
    await settle();
    listeners.get("tauri://drag-drop")?.({ payload: { paths: ["/tmp/a.txt"] } });
    await settle();
    expect(calls).toEqual([]);
    expect(got).toEqual([]);

    enabled = true;
    listeners.get("tauri://drag-drop")?.({ payload: { paths: ["/tmp/a.txt"] } });
    await settle();
    expect(calls.map((c) => c.cmd)).toEqual(["stat_dropped_file"]);
    expect(got).toHaveLength(1);
    off();
  });

  it("缺省:stat_dropped_file 造 path-backed 占位 File(0 字节 + 真实路径)", async () => {
    const { listeners, calls } = stubDropShell(() => ({ name: "笔记.txt", mediaType: "" }));
    const got: File[][] = [];
    const off = onNativeFileDrop({ onDragging: () => {}, onFiles: (f) => got.push(f) });
    await settle();
    listeners.get("tauri://drag-drop")?.({ payload: { paths: ["/home/u/笔记.txt"] } });
    await settle();
    expect(calls.map((c) => c.cmd)).toEqual(["stat_dropped_file"]);
    expect(got[0]![0]!.size).toBe(0);
    expect(nativePathOf(got[0]![0]!)).toBe("/home/u/笔记.txt");
    off();
  });

  it("wantContent:read_dropped_file 读回字节还原成真 File(云端附件必须拿得到内容)", async () => {
    const { listeners, calls } = stubDropShell(() => ({
      name: "图.png",
      mediaType: "image/png",
      data: b64OfBytes(new Uint8Array([1, 2, 3, 4, 5]).buffer),
    }));
    const got: File[][] = [];
    const off = onNativeFileDrop({ wantContent: true, onDragging: () => {}, onFiles: (f) => got.push(f) });
    await settle();
    listeners.get("tauri://drag-drop")?.({ payload: { paths: ["/home/u/图.png"] } });
    await settle();
    expect(calls.map((c) => c.cmd)).toEqual(["read_dropped_file"]);
    const f = got[0]![0]!;
    expect(f.name).toBe("图.png");
    expect(f.type).toBe("image/png");
    expect(f.size).toBe(5); // 非零:uploadCloudFile 的 size===0 拦截过得去
    expect([...new Uint8Array(await f.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    off();
  });

  it("wantContent:壳读取失败(过大/是目录)逐个上抛原因,不静默丢", async () => {
    const { listeners } = stubDropShell(() => Promise.reject(new Error("文件过大(上限 20MB)")));
    const errs: string[] = [];
    const got: File[][] = [];
    const off = onNativeFileDrop({
      wantContent: true,
      onDragging: () => {},
      onFiles: (f) => got.push(f),
      onError: (m) => errs.push(m),
    });
    await settle();
    listeners.get("tauri://drag-drop")?.({ payload: { paths: ["/big.bin"] } });
    await settle();
    expect(errs).toEqual(["文件过大(上限 20MB)"]);
    expect(got).toEqual([]); // 一个都没成:不调 onFiles
    off();
  });
});

describe("path-backed File 与图片判定", () => {
  it("占位 File 带回真实路径;普通 File 无", () => {
    const f = pathBackedFile("/tmp/猫.png", "猫.png", "image/png");
    expect(nativePathOf(f)).toBe("/tmp/猫.png");
    expect(f.name).toBe("猫.png");
    expect(nativePathOf(new File([], "x"))).toBeUndefined();
  });

  it("isImagePath 与壳侧 image_mime 同口径", () => {
    expect(isImagePath(".monkeycode/uploads/a.PNG")).toBe(true);
    expect(isImagePath("b.jpeg")).toBe(true);
    expect(isImagePath("c.txt")).toBe(false);
    expect(isImagePath("noext")).toBe(false);
  });

  it("b64OfBytes 跨 32KB 段界仍逐字节一致", () => {
    const n = 0x8000 + 5;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = i % 251;
    expect([...decode(b64OfBytes(bytes.buffer))]).toEqual([...bytes]);
  });
});
