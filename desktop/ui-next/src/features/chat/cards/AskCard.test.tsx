import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AskItem } from "@/lib/protocol/types";
import { AskCard } from "./AskCard";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

interface Call {
  cmd: string;
  args?: Record<string, unknown>;
}

function stubShell(): Call[] {
  const calls: Call[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return Promise.resolve(undefined);
      },
    },
  };
  return calls;
}

const SINGLE: AskItem = {
  kind: "ask",
  askId: "q1",
  state: "open",
  questions: [
    {
      question: "选哪个方案?",
      header: "方案",
      multiSelect: false,
      custom: true,
      options: [
        { label: "方案 A", description: "保守" },
        { label: "方案 B" },
      ],
    },
  ],
};

const MULTI: AskItem = {
  kind: "ask",
  askId: "q2",
  state: "open",
  questions: [
    { question: "选哪个方案?", multiSelect: false, custom: false, options: [{ label: "方案 A" }, { label: "方案 B" }] },
    { question: "要哪些依赖?", multiSelect: true, custom: false, options: [{ label: "x" }, { label: "y" }] },
  ],
};

describe("AI 提问卡", () => {
  it("单选:radio 呈现,未作答提交不可点,选中后提交发 reply-question 并收成只读摘要", async () => {
    const calls = stubShell();
    render(<AskCard item={SINGLE} sessionId="s1" />);
    expect(screen.getByText("需要你的回答")).toBeTruthy();
    expect(screen.getByText("方案")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "提交回答" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("请回答全部问题")).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: /方案 A/ }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(submit);

    const sent = calls.find((c) => c.cmd === "session_send");
    expect(sent?.args).toEqual({
      id: "s1",
      ftype: "reply-question",
      payload: { request_id: "q1", answers_json: JSON.stringify({ "选哪个方案?": "方案 A" }), cancelled: false },
    });
    // 乐观收卡:答案按用户消息形态靠右(chat-end 气泡)
    expect(screen.getByText("方案 A").closest(".chat-end")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "提交回答" })).toBeNull();
  });

  it("多题多选:全部作答才可提交,多选答案是数组", async () => {
    const calls = stubShell();
    render(<AskCard item={MULTI} sessionId="s1" />);
    const submit = screen.getByRole("button", { name: "提交回答" });

    await userEvent.click(screen.getByRole("radio", { name: "方案 B" }));
    expect((submit as HTMLButtonElement).disabled).toBe(true); // 第二题还没答
    expect(screen.getByText("可多选")).toBeTruthy();
    await userEvent.click(screen.getByRole("checkbox", { name: "x" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "y" }));
    await userEvent.click(submit);

    const sent = calls.find((c) => c.cmd === "session_send");
    const payload = sent?.args?.payload as { answers_json: string };
    expect(JSON.parse(payload.answers_json)).toEqual({ "选哪个方案?": "方案 B", "要哪些依赖?": ["x", "y"] });
  });

  it("选择答案后按 Enter 提交", async () => {
    const calls = stubShell();
    render(<AskCard item={SINGLE} sessionId="s1" />);

    const option = screen.getByRole("radio", { name: /方案 A/ });
    await userEvent.click(option);
    await userEvent.keyboard("{Enter}");

    const sent = calls.find((c) => c.cmd === "session_send");
    expect(sent?.args?.payload).toEqual({
      request_id: "q1",
      answers_json: JSON.stringify({ "选哪个方案?": "方案 A" }),
      cancelled: false,
    });
  });

  it("「其他」自定义:勾选后出输入框,内容为空不可提交,提交带自定义文本", async () => {
    const calls = stubShell();
    render(<AskCard item={SINGLE} sessionId="s1" />);
    const submit = screen.getByRole("button", { name: "提交回答" });

    await userEvent.click(screen.getByRole("radio", { name: "其他" }));
    expect((submit as HTMLButtonElement).disabled).toBe(true); // 自定义还没写内容
    await userEvent.type(screen.getByRole("textbox", { name: "输入你的回答" }), "都不选,先重构");
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(submit);

    const sent = calls.find((c) => c.cmd === "session_send");
    const payload = sent?.args?.payload as { answers_json: string };
    expect(JSON.parse(payload.answers_json)).toEqual({ "选哪个方案?": "都不选,先重构" });
  });

  it("跳过回答:reply-question cancelled=true,卡片收成未回答摘要", async () => {
    const calls = stubShell();
    render(<AskCard item={SINGLE} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "跳过回答" }));
    const sent = calls.find((c) => c.cmd === "session_send");
    expect(sent?.args?.payload).toEqual({ request_id: "q1", answers_json: "{}", cancelled: true });
    expect(screen.getAllByText("未回答").length).toBeGreaterThan(0);
  });

  it("提交失败回滚:卡片重新可作答(答复没送达不能假装已答)", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.reject(new Error("boom")) },
    };
    render(<AskCard item={SINGLE} sessionId="s1" />);
    await userEvent.click(screen.getByRole("radio", { name: /方案 A/ }));
    await userEvent.click(screen.getByRole("button", { name: "提交回答" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "提交回答" })).toBeTruthy());
  });

  it("done 态(回显/回放)渲染只读答案", () => {
    stubShell();
    const done: AskItem = {
      ...SINGLE,
      state: "done",
      questions: [{ ...SINGLE.questions[0]!, answer: "方案 B" }],
    };
    render(<AskCard item={done} sessionId="s1" />);
    expect(screen.getByText("方案 B").closest(".chat-end")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("expired 收成一行弱提示", () => {
    stubShell();
    render(<AskCard item={{ ...SINGLE, state: "expired" }} sessionId="s1" />);
    expect(screen.getByText("提问已过期 · 未回答")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
