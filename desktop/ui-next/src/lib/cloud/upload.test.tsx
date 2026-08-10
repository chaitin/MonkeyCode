// 云端附件上传管线:文件名归一(剪贴板截图补扩展名)、校验拦截(空文件/
// 缺扩展名/超限)、成功路径经 mc_upload 出 access_url。canvas 压缩路径在
// jsdom 不可用(getContext 未实现)→ compressImage 返回 null 回退原图,
// 正好钉住「压缩失败绝不能变成上传失败」的契约。
import { afterEach, describe, expect, it } from "vitest";

import { isImageFilename, normalizeUploadName, uploadCloudFile } from "./upload";

function stubShell(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("normalizeUploadName", () => {
  it("有扩展名的原样保留", () => {
    expect(normalizeUploadName(new File(["x"], "a.txt", { type: "text/plain" }))).toBe("a.txt");
  });
  it("无扩展名但可从 MIME 推断:补扩展名;空名补时间戳名", () => {
    expect(normalizeUploadName(new File(["x"], "shot", { type: "image/png" }))).toBe("shot.png");
    expect(normalizeUploadName(new File(["x"], "", { type: "image/png" }))).toMatch(/^pasted-image-\d{14}\.png$/);
  });
  it("推不出扩展名的原样返回(调用方拦截)", () => {
    expect(normalizeUploadName(new File(["x"], "noext", { type: "application/octet-stream" }))).toBe("noext");
  });
});

describe("isImageFilename", () => {
  it("按扩展名清单判定", () => {
    expect(isImageFilename("a.PNG")).toBe(true);
    expect(isImageFilename("b.webp")).toBe(true);
    expect(isImageFilename("c.txt")).toBe(false);
  });
});

describe("uploadCloudFile", () => {
  it("文本文件:base64 经 mc_upload 直传,返回 access_url;非图片无 preview", async () => {
    const calls: Record<string, unknown>[] = [];
    stubShell((cmd, args) => {
      if (cmd === "mc_upload") {
        calls.push(args ?? {});
        return Promise.resolve({ access_url: "https://oss/a.txt" });
      }
      return Promise.resolve({});
    });
    const att = await uploadCloudFile(new File(["hello"], "a.txt", { type: "text/plain" }));
    expect(att).toEqual({ url: "https://oss/a.txt", filename: "a.txt", isImage: false });
    expect(calls[0]?.filename).toBe("a.txt");
    expect(atob(String(calls[0]?.data))).toBe("hello");
  });

  it("小图片:jsdom 无 canvas → 压缩优雅回退,原图照传且带 preview", async () => {
    stubShell((cmd) =>
      cmd === "mc_upload" ? Promise.resolve({ access_url: "https://oss/p.png" }) : Promise.resolve({}),
    );
    const att = await uploadCloudFile(new File(["png-bytes"], "p.png", { type: "image/png" }));
    expect(att.url).toBe("https://oss/p.png");
    expect(att.isImage).toBe(true);
    expect(att.preview).toMatch(/^data:/);
  });

  it("空文件/缺扩展名/超 2MB 逐条拦截(不发请求)", async () => {
    stubShell(() => Promise.reject(new Error("不应发请求")));
    await expect(uploadCloudFile(new File([], "a.txt"))).rejects.toThrow(/空文件/);
    await expect(uploadCloudFile(new File(["x"], "noext", { type: "application/octet-stream" }))).rejects.toThrow(
      /缺少扩展名/,
    );
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.bin", { type: "application/octet-stream" });
    await expect(uploadCloudFile(big)).rejects.toThrow(/2MB/);
  });
});
