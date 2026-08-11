import { describe, expect, it } from "vitest";

import { anchorScrollTop, findAnchor, OUTLINE_JUMP_INSET, outlineActiveSeq } from "./scrollAnchor";

describe("findAnchor(保存:视口顶条目 + 条目内偏移)", () => {
  it("空列表回零锚(新会话/内容未物化)", () => {
    expect(findAnchor([], 120)).toEqual({ anchor: 0, offset: 0 });
  });

  it("单条:无论滚多深都锚在它身上,offset = 条目内已滚过距离", () => {
    expect(findAnchor([0], 0)).toEqual({ anchor: 0, offset: 0 });
    expect(findAnchor([0], 300)).toEqual({ anchor: 0, offset: 300 });
  });

  it("多条:选第一个底边(下一条 top)仍在视口顶之下的条目", () => {
    const tops = [0, 100, 250];
    expect(findAnchor(tops, 0)).toEqual({ anchor: 0, offset: 0 });
    expect(findAnchor(tops, 99)).toEqual({ anchor: 0, offset: 99 });
    expect(findAnchor(tops, 100)).toEqual({ anchor: 1, offset: 0 }); // 恰在底边:归下一条
    expect(findAnchor(tops, 180)).toEqual({ anchor: 1, offset: 80 });
    expect(findAnchor(tops, 9_999)).toEqual({ anchor: 2, offset: 9_749 }); // 末条延伸到内容尾
  });

  it("条目起点不在 0(容器有内边距)时 offset 可为负:视口顶还在首条之上", () => {
    expect(findAnchor([12, 112], 0)).toEqual({ anchor: 0, offset: -12 });
  });
});

describe("anchorScrollTop(恢复:锚点 → scrollTop,越界钳制)", () => {
  it("空列表回 0", () => {
    expect(anchorScrollTop([], 3, 40)).toBe(0);
  });

  it("anchor 越界钳制:超出对到最后一条(条目还没物化齐),负数对到首条", () => {
    const tops = [0, 100, 250];
    expect(anchorScrollTop(tops, 99, 10)).toBe(260);
    expect(anchorScrollTop(tops, -5, 10)).toBe(10);
  });

  it("offset 为负也不滚出上边界(结果钳到 0)", () => {
    expect(anchorScrollTop([0, 100], 0, -50)).toBe(0);
  });

  it("恢复往返一致:findAnchor 的结果反算回原 scrollTop", () => {
    const tops = [0, 80, 200, 460];
    for (const v of [0, 1, 79, 80, 133, 200, 459, 460, 1000]) {
      const { anchor, offset } = findAnchor(tops, v);
      expect(anchorScrollTop(tops, anchor, offset)).toBe(v);
    }
  });
});

describe("outlineActiveSeq(视口当前提问判定,移植旧 outline.tsx)", () => {
  it("空列表回 null", () => {
    expect(outlineActiveSeq([], 0)).toBeNull();
  });

  it("滚动到顶部且首条受容器内边距下移时，首条仍是当前项", () => {
    expect(outlineActiveSeq([{ seq: 1, top: 48 }], 0)).toBe(1);
  });

  it("取顶线之上最后一条的 seq", () => {
    const seqTops = [
      { seq: 1, top: 0 },
      { seq: 2, top: 300 },
      { seq: 3, top: 600 },
    ];
    expect(outlineActiveSeq(seqTops, 0)).toBe(1);
    expect(outlineActiveSeq(seqTops, 300)).toBe(2);
    expect(outlineActiveSeq(seqTops, 601)).toBe(3);
  });

  it("恰好停在 INSET 线上的条目算当前项(含 1px 亚像素余量)", () => {
    const seqTops = [
      { seq: 1, top: 0 },
      { seq: 2, top: 500 },
    ];
    expect(outlineActiveSeq(seqTops, 500 - OUTLINE_JUMP_INSET)).toBe(2);
    expect(outlineActiveSeq(seqTops, 500 - OUTLINE_JUMP_INSET - 1)).toBe(2); // 1px 余量内
    expect(outlineActiveSeq(seqTops, 500 - OUTLINE_JUMP_INSET - 2)).toBe(1);
  });
});
