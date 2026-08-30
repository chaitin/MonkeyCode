import { describe, expect, it } from "vitest";

import { ATT_LINE, attLineFor, attLineOf, DIR_LINE, dirLineOf, splitAttachments } from "./attLine";

describe("附件行约定(唯一出处)", () => {
  it("attLineOf 与 ATT_LINE 互为逆:拼出来的行必被识别", () => {
    expect(attLineOf(".monkeycode/uploads/a.png", true)).toMatch(ATT_LINE);
    expect(attLineOf("docs/b.txt", false)).toMatch(ATT_LINE);
  });

  it("splitAttachments:正文/图片/文件三路分离,顺序保持", () => {
    const r = splitAttachments("看看这个\n[图片] up/a.png\n[文件] up/b.txt\n[图片] up/c.png");
    expect(r.body).toBe("看看这个");
    expect(r.images).toEqual(["up/a.png", "up/c.png"]);
    expect(r.files).toEqual(["up/b.txt"]);
  });

  it("纯附件消息 body 为空;无附件消息原样保留(含中间空行)", () => {
    expect(splitAttachments("[图片] a.png").body).toBe("");
    const plain = splitAttachments("第一行\n\n第三行");
    expect(plain.body).toBe("第一行\n\n第三行");
    expect(plain.images).toEqual([]);
  });

  it("非行首/带多余空格的伪附件行不识别(路径含空格即整行当正文)", () => {
    const r = splitAttachments("前缀 [图片] a.png\n[图片] 有 空格.png");
    expect(r.images).toEqual([]);
    expect(r.body).toContain("有 空格.png");
  });

  it("dirLineOf 与 DIR_LINE 互为逆;目录路径允许空格(用户在系统对话框里选的)", () => {
    expect(dirLineOf("/Users/me/mats")).toMatch(DIR_LINE);
    const r = splitAttachments(dirLineOf("/Users/me/Design Materials"));
    expect(r.dirs).toEqual(["/Users/me/Design Materials"]);
    expect(r.body).toBe("");
  });

  it("目录行与上传附件行同时出现时各归各路,顺序保持", () => {
    const r = splitAttachments("看下\n[图片] up/a.png\n[目录] /tmp/mats\n[文件] up/b.txt");
    expect(r.body).toBe("看下");
    expect(r.images).toEqual(["up/a.png"]);
    expect(r.files).toEqual(["up/b.txt"]);
    expect(r.dirs).toEqual(["/tmp/mats"]);
  });

  it("attLineFor 按 isDir 分流:目录不落成 [文件] 行", () => {
    expect(attLineFor({ path: "/tmp/mats", isImage: false, isDir: true })).toBe("[目录] /tmp/mats");
    expect(attLineFor({ path: "up/a.png", isImage: true })).toBe("[图片] up/a.png");
    expect(attLineFor({ path: "up/b.txt", isImage: false })).toBe("[文件] up/b.txt");
  });
});
