import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillsMenu } from "@/features/chat/composer/pickers";
import { SkillsCatalogProvider, useSkillsCatalog, type SkillsCatalogValue } from "./SkillsCatalogProvider";

let catalogApi: SkillsCatalogValue | null = null;
function Probe() {
  const value = useSkillsCatalog();
  useEffect(() => {
    catalogApi = value;
  }, [value]);
  return <div data-testid="catalog">{`${value.revision}:${value.skills.map((skill) => skill.name).join(",")}:${value.loading}`}</div>;
}

function MountedSkillsMenu() {
  const value = useSkillsCatalog();
  return (
    <>
      <div data-testid="mounted-skill-list">{value.skills.map((entry) => entry.name).join(",")}</div>
      <SkillsMenu
        skills={value.skills}
        enabled={[]}
        onChange={() => {}}
        onOpen={value.calibrateSkillsCatalog}
      />
    </>
  );
}

const skill = (name: string) => ({ name, description: name, source: "user" as const, content: "", overrides: false, default_enabled: true });

afterEach(() => {
  catalogApi = null;
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("SkillsCatalogProvider revision 协议", () => {
  it("首次 reconcile 严格等待监听注册完成；监听晚于 unmount 完成时立即 unlisten", async () => {
    let finishListen: ((off: () => void) => void) | undefined;
    const off = vi.fn();
    const invoke = vi.fn(() => Promise.resolve({ revision: 1, store_id: "s", skills: [] }));
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: () => new Promise<() => void>((resolve) => { finishListen = resolve; }) },
    };
    const mounted = render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(finishListen).toBeTypeOf("function"));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => finishListen?.(off));
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    mounted.unmount();
    expect(off).toHaveBeenCalledOnce();

    let finishLateListen: ((off: () => void) => void) | undefined;
    const lateOff = vi.fn();
    const lateInvoke = vi.fn();
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: lateInvoke },
      event: { listen: () => new Promise<() => void>((resolve) => { finishLateListen = resolve; }) },
    };
    const late = render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(finishLateListen).toBeTypeOf("function"));
    late.unmount();
    await act(async () => finishLateListen?.(lateOff));
    expect(lateOff).toHaveBeenCalledOnce();
    expect(lateInvoke).not.toHaveBeenCalled();
  });

  it("监听失败先给结构化 error，再 fallback query；后续 focus 仍可校准", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const invoke = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: () => Promise.reject(new Error("listen boom")) },
    };
    render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect((catalogApi?.error as { code?: string } | null)?.code).toBe("skills-catalog-listen-failed"));
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => pending[0]?.({ revision: 1, store_id: "s", skills: [] }));
    await waitFor(() => expect(catalogApi?.error).toBeNull());
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("服务端 revision 主导，旧 generation 的更高响应仍接受；generation 只结束 loading", async () => {
    const pending: Array<(value: unknown) => void> = [];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: () => new Promise((resolve) => pending.push(resolve)) },
      event: { listen: async () => () => {} },
    };
    render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1]?.({ revision: 2, store_id: "s", skills: [skill("two")] }));
    expect(screen.getByTestId("catalog").textContent).toBe("2:two:false");
    // 首次请求 generation 更旧，但服务端 revision 更高，必须接受。
    await act(async () => pending[0]?.({ revision: 3, store_id: "s", skills: [skill("three")] }));
    expect(screen.getByTestId("catalog").textContent).toBe("3:three:false");
  });

  it("catalog 事件、focus 与显式菜单校准都触发 list；目标 revision 未到会重试", async () => {
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    const responses = [
      { revision: 1, store_id: "s", skills: [] },
      { revision: 1, store_id: "s", skills: [] },
      { revision: 1, store_id: "s", skills: [] },
      { revision: 4, store_id: "s", skills: [skill("four")] },
    ];
    const invoke = vi.fn(() => Promise.resolve(responses.shift() ?? { revision: 4, store_id: "s", skills: [skill("four")] }));
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: async (_name: string, cb: (event: { payload: unknown }) => void) => { eventHandler = cb; return () => {}; } },
    };
    render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(catalogApi?.revision).toBe(1));
    act(() => eventHandler?.({ payload: { revision: 2, store_id: "s" } }));
    act(() => window.dispatchEvent(new Event("focus")));
    catalogApi?.calibrateSkillsCatalog();
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(4));
    await act(async () => {
      const snapshot = await catalogApi?.refreshSkillsCatalog(4);
      expect(snapshot?.revision).toBeGreaterThanOrEqual(4);
    });
    expect(catalogApi?.skills.map((item) => item.name)).toEqual(["four"]);
  });

  it("跨实例 store 事件、focus 和真实菜单打开依次校准所有已挂载消费者", async () => {
    let catalogChanged: ((event: { payload: unknown }) => void) | undefined;
    const responses = [
      { revision: 40, store_id: "instance-a", skills: [skill("initial")] },
      // 新实例的 revision 可从低值重新开始；store_id 是换权威源的判据。
      { revision: 1, store_id: "instance-b", skills: [skill("cross-instance")] },
      { revision: 2, store_id: "instance-b", skills: [skill("focus-calibrated")] },
      { revision: 3, store_id: "instance-b", skills: [skill("menu-calibrated")] },
    ];
    const invoke = vi.fn(() => Promise.resolve(responses.shift()));
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen: async (_name: string, cb: (event: { payload: unknown }) => void) => {
        catalogChanged = cb;
        return () => {};
      } },
    };

    render(<SkillsCatalogProvider><Probe /><MountedSkillsMenu /></SkillsCatalogProvider>);
    await waitFor(() => expect(screen.getByTestId("mounted-skill-list").textContent).toBe("initial"));

    act(() => catalogChanged?.({ payload: { revision: 1, store_id: "instance-b" } }));
    await waitFor(() => expect(screen.getByTestId("mounted-skill-list").textContent).toBe("cross-instance"));
    expect(catalogApi?.storeId).toBe("instance-b");
    expect(catalogApi?.revision).toBe(1);

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.getByTestId("mounted-skill-list").textContent).toBe("focus-calibrated"));

    await act(async () => screen.getByRole("button", { name: "会话技能" }).click());
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "menu-calibrated" })).toBeTruthy());
    expect(screen.queryByRole("checkbox", { name: "focus-calibrated" })).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("接受更高 catalog 前先等待会话同步屏障", async () => {
    let release: (() => void) | undefined;
    const beforeAccept = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.resolve({ revision: 5, store_id: "s", skills: [skill("blocked")] }) },
      event: { listen: async () => () => {} },
    };
    render(<SkillsCatalogProvider beforeAcceptCatalog={beforeAccept}><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(beforeAccept).toHaveBeenCalledOnce());
    expect(catalogApi?.revision).toBe(0);
    await act(async () => release?.());
    await waitFor(() => expect(catalogApi?.revision).toBe(5));
  });

  it("旧 generation 的失败/成功都不能覆盖 latest 请求的 error/loading", async () => {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
      event: { listen: async () => () => {} },
    };
    render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1]?.resolve({ revision: 2, store_id: "s", skills: [skill("latest")] }));
    expect(catalogApi?.error).toBeNull();
    expect(catalogApi?.loading).toBe(false);
    await act(async () => pending[0]?.reject(new Error("stale failure")));
    expect(catalogApi?.revision).toBe(2);
    expect(catalogApi?.error).toBeNull();
    expect(catalogApi?.loading).toBe(false);

    act(() => catalogApi?.calibrateSkillsCatalog());
    act(() => catalogApi?.calibrateSkillsCatalog());
    await waitFor(() => expect(pending).toHaveLength(4));
    const latestFailure = new Error("latest failure");
    await act(async () => pending[3]?.reject(latestFailure));
    expect(catalogApi?.error).toBe(latestFailure);
    expect(catalogApi?.loading).toBe(false);
    // generation 3 的旧 success 仍可提升 catalog，但不能清 generation 4 的 error。
    await act(async () => pending[2]?.resolve({ revision: 9, store_id: "s", skills: [skill("higher-old")] }));
    expect(catalogApi?.revision).toBe(9);
    expect(catalogApi?.error).toBe(latestFailure);
    expect(catalogApi?.loading).toBe(false);
  });

  it("target N 与 focus N+1 都失败时，即使新请求先返回也会 reject target waiter", async () => {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
      event: { listen: async () => () => {} },
    };
    render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.resolve({ revision: 1, store_id: "s", skills: [] }));
    await waitFor(() => expect(catalogApi?.revision).toBe(1));

    const targetFailure = { code: "recovery-pending", message: "target recovery", issues: [] };
    const focusFailure = { code: "recovery-pending", message: "focus recovery", issues: [] };
    let targetOutcome!: Promise<{ status: "resolved"; value: unknown } | { status: "rejected"; reason: unknown }>;
    act(() => {
      targetOutcome = catalogApi!.refreshSkillsCatalog(5).then(
        (value) => ({ status: "resolved" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(pending).toHaveLength(3));

    await act(async () => pending[2]?.reject(focusFailure));
    expect(catalogApi?.error).toBe(focusFailure);
    expect(catalogApi?.loading).toBe(false);
    await act(async () => pending[1]?.reject(targetFailure));
    await expect(targetOutcome).resolves.toEqual({ status: "rejected", reason: targetFailure });
    // 旧 generation 只 settle 自己的 waiter，不覆盖新请求用于恢复 UI 的错误。
    expect(catalogApi?.error).toBe(focusFailure);
    expect(catalogApi?.loading).toBe(false);
  });

  it("focus N+1 先成功达到 target 后，target N 的迟到失败不能反转 resolve 或 UI", async () => {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
      event: { listen: async () => () => {} },
    };
    render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]?.resolve({ revision: 1, store_id: "s", skills: [] }));
    await waitFor(() => expect(catalogApi?.revision).toBe(1));

    let targetOutcome!: Promise<{ status: "resolved"; value: unknown } | { status: "rejected"; reason: unknown }>;
    act(() => {
      targetOutcome = catalogApi!.refreshSkillsCatalog(5).then(
        (value) => ({ status: "resolved" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(pending).toHaveLength(3));

    const accepted = { revision: 5, store_id: "s", skills: [skill("five")] };
    await act(async () => pending[2]?.resolve(accepted));
    await expect(targetOutcome).resolves.toEqual({ status: "resolved", value: accepted });
    const staleFailure = { code: "recovery-pending", message: "stale recovery", issues: [] };
    await act(async () => pending[1]?.reject(staleFailure));
    expect(catalogApi?.revision).toBe(5);
    expect(catalogApi?.error).toBeNull();
    expect(catalogApi?.loading).toBe(false);
  });

  it("target waiter 只由接受到的 server revision 唤醒，unmount 会 reject 清理", async () => {
    const responses = [
      { revision: 1, store_id: "s", skills: [] },
      { revision: 2, store_id: "s", skills: [skill("two")] },
      { revision: 4, store_id: "s", skills: [skill("four")] },
      { revision: 4, store_id: "s", skills: [skill("four")] },
    ];
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: () => Promise.resolve(responses.shift()) },
      event: { listen: async () => () => {} },
    };
    const mounted = render(<SkillsCatalogProvider><Probe /></SkillsCatalogProvider>);
    await waitFor(() => expect(catalogApi?.revision).toBe(1));
    let settled = false;
    let waiting!: Promise<unknown>;
    await act(async () => {
      waiting = catalogApi!.refreshSkillsCatalog(4).then((value) => {
        settled = true;
        return value;
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(catalogApi?.revision).toBe(2));
    expect(settled).toBe(false);
    await act(async () => {
      catalogApi?.calibrateSkillsCatalog();
      await Promise.resolve();
    });
    await expect(waiting).resolves.toMatchObject({ revision: 4 });

    let never!: Promise<unknown>;
    await act(async () => {
      never = catalogApi!.refreshSkillsCatalog(10);
      await Promise.resolve();
    });
    await waitFor(() => expect(catalogApi?.revision).toBe(4));
    mounted.unmount();
    await expect(never).rejects.toMatchObject({ code: "skills-catalog-provider-unmounted" });
  });
});
