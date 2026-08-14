import { Profiler } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import { createChatState } from "@/lib/protocol/reduce";
import type { ChatItem } from "@/lib/protocol/types";
import { LocalComposerHost } from "./composer/LocalComposerHost";
import { LogList } from "./LogList";
import { TIMELINE_MAX_RENDERED_ROWS } from "./timeline/useTimelineWindow";

const META: SessionMeta = {
  id: "perf-session",
  title: "长会话",
  workdir: "/tmp/project",
  model: "m",
  turns: 5_000,
  status: "idle",
};

function stubShell() {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (command: string) => {
        if (command === "models_list" || command === "skills_list") return Promise.resolve([]);
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("长会话输入隔离", () => {
  it("一万条历史下逐键更新只提交 composer，不提交消息时间线", async () => {
    stubShell();
    const items: ChatItem[] = Array.from({ length: 10_000 }, (_, index) => ({
      kind: "sys" as const,
      text: `history ${index}`,
    }));
    const state = { ...createChatState(), items };
    let timelineCommits = 0;
    const { container } = render(
      <>
        <div data-chat-log="">
          <Profiler id="timeline" onRender={() => timelineCommits++}>
            <LogList state={state} sessionId={META.id} />
          </Profiler>
        </div>
        <LocalComposerHost sessionId={META.id} state={state} historyLoaded meta={META} />
      </>,
    );

    const mountedBefore = [...container.querySelectorAll<HTMLElement>("[data-virtual-row]")];
    expect(mountedBefore.length).toBeLessThanOrEqual(TIMELINE_MAX_RENDERED_ROWS);
    const commitsBeforeTyping = timelineCommits;
    const firstRow = mountedBefore[0];

    await userEvent.type(screen.getByRole("textbox", { name: "消息输入" }), "连续输入二十个字符不会拖着历史重排");

    expect(timelineCommits).toBe(commitsBeforeTyping);
    expect(container.querySelector("[data-virtual-row]")).toBe(firstRow);
    expect(container.querySelectorAll("[data-virtual-row]").length).toBeLessThanOrEqual(
      TIMELINE_MAX_RENDERED_ROWS,
    );
  });
});
