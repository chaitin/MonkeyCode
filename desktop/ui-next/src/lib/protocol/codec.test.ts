// codec 单测:base64 的 UTF-8 正确性、frameData 双格式容错、user-input
// 解码兜底、工具载荷文本提取。纯函数,node 环境直接跑。
import { describe, expect, it } from "vitest";

import { b64decode, b64encode, decodeUserInput, frameData, toolContentText, toolResultText } from "./codec";
import type { Frame } from "./types";

describe("base64 工具(UTF-8)", () => {
  it("ASCII/中文/emoji 均可往返(atob 只还原字节,多字节必须过 TextDecoder)", () => {
    for (const text of ["hello", "修复 Bug🐛", "帮我看下这个 panic", "混合 mixed 🚀 内容"]) {
      expect(b64decode(b64encode(text))).toBe(text);
    }
  });

  it("能解开壳侧产出的 base64(与 Rust 侧同一素材对表)", () => {
    // desktop/fixtures/replay/raw.jsonl 首帧的 content(壳真实产出)
    expect(b64decode("5biu5oiR55yL5LiL6L+Z5LiqIHBhbmlj")).toBe("帮我看下这个 panic");
  });

  it("非法 base64 抛错(atob 语义;兜底由调用方按场景决定)", () => {
    expect(() => b64decode("!!!不是base64")).toThrow();
  });
});

describe("frameData 双格式解包", () => {
  const obj = { update: { sessionUpdate: "plan" } };

  it("新格式:内联 JSON 对象原样返回", () => {
    const f: Frame = { type: "task-running", data: obj };
    expect(frameData(f)).toEqual(obj);
  });

  it("旧格式:base64(JSON) 字符串解包(存量 journal 回放)", () => {
    const f: Frame = { type: "task-running", data: b64encode(JSON.stringify(obj)) };
    expect(frameData(f)).toEqual(obj);
  });

  it("云端裸 JSON 字符串兜底", () => {
    const f: Frame = { type: "task-error", data: JSON.stringify({ error: "裸串" }) };
    expect(frameData(f)).toEqual({ error: "裸串" });
  });

  it("缺 data/null/不可解的形态一律返回 null,不抛", () => {
    expect(frameData({ type: "task-started" })).toBeNull();
    expect(frameData({ type: "task-started", data: null })).toBeNull();
    expect(frameData({ type: "task-started", data: "既不是 base64 也不是 JSON" })).toBeNull();
    expect(frameData({ type: "task-started", data: 42 })).toBeNull();
  });

  it("base64(非 JSON 文本)不误判:落到裸 JSON 分支再失败,返回 null", () => {
    expect(frameData({ type: "x", data: b64encode("纯文本不是 JSON") })).toBeNull();
  });
});

describe("decodeUserInput(user-input.content 恒为 base64 文本)", () => {
  it("正常解码含多字节文本", () => {
    expect(decodeUserInput(b64encode("修复 Bug🐛"))).toBe("修复 Bug🐛");
  });

  it("坏编码回退原文,空值回退空串——用户消息宁可显示原始串也不能丢", () => {
    expect(decodeUserInput("!!!不是base64")).toBe("!!!不是base64");
    expect(decodeUserInput(undefined)).toBe("");
    expect(decodeUserInput("")).toBe("");
  });
});

describe("工具载荷文本提取", () => {
  it("content:字符串/{text} 分片/嵌套 block 数组均可取出文本", () => {
    expect(toolContentText("直接字符串")).toBe("直接字符串");
    expect(toolContentText({ text: "分片" })).toBe("分片");
    expect(
      toolContentText([
        { type: "content", content: { type: "text", text: "第一块" } },
        { type: "content", content: { type: "text", text: "第二块" } },
      ]),
    ).toBe("第一块\n第二块");
    expect(toolContentText(null)).toBe("");
    expect(toolContentText(123)).toBe("");
  });

  it("content:嵌套深度封顶,自引用结构不炸", () => {
    const loop: Record<string, unknown> = {};
    loop.content = loop;
    expect(toolContentText(loop)).toBe("");
  });

  it("rawOutput:字符串直取;{output}/{result}/{stdout,stderr}/{error} 各形态兜住", () => {
    expect(toolResultText("原样输出")).toBe("原样输出");
    expect(toolResultText({ output: "对象输出" })).toBe("对象输出");
    expect(toolResultText({ result: "结果字段" })).toBe("结果字段");
    expect(toolResultText({ stdout: "标准输出", stderr: "错误输出" })).toBe("标准输出\n错误输出");
    expect(toolResultText({ error: "出错了" })).toBe("出错了");
    expect(toolResultText({ message: "消息" })).toBe("消息");
  });

  it("rawOutput 取不到文本时回退 content block", () => {
    expect(toolResultText(undefined, [{ type: "content", content: { type: "text", text: "流式正文" } }])).toBe(
      "流式正文",
    );
    expect(toolResultText({}, { text: "兜底" })).toBe("兜底");
    expect(toolResultText(undefined, undefined)).toBe("");
  });
});
