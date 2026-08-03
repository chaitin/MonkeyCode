import { describe, expect, it } from "vitest";

import { ATT_LINE, attLineOf, splitAttachments } from "./attLine";

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
});
