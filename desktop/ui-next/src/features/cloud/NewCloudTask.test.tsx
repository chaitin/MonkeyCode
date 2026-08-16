// 新建云端任务:三选器默认值、locked 禁选、提交契约(假壳 invoke)。
// 三选器为 composer 同款菜单(pickers.OptionMenu):触发器 button 文本 =
// 当前选中项展示名,列表 list 与触发器同可及名(role 区分)。
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewCloudTask } from "./NewCloudTask";
import { McTransportProvider } from "@/lib/mcTransport";

const OPTIONS = {
  models: [
    { id: "m-basic", model: "monkeycode-basic-x", owner: { type: "public" }, weight: 1 },
    { id: "m-ultra", model: "monkeycode-ultra-x", owner: { type: "public" }, weight: 9 },
    { id: "m-mine", model: "my-model", owner: { type: "private" } },
  ],
  images: [
    { id: "i-devbox", remark: "devbox", owner: { type: "public" } },
    { id: "i-other", name: "reg/foo:1" },
  ],
  hosts: [{ id: "h-1", name: "私有机", status: "online" }],
  projects: [],
  plan: "", // 免费档:ultra 应 locked
};

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

/** 面板先确认登录态再拉选项:未连接时给空态而不是把 401 原文摊出来。
 * status 参数模拟 mc_status 的三种结局(已连接 / 未登录 / 自身抛错)。 */
function stubShell(
  created: Record<string, unknown>[] = [],
  options: Record<string, unknown> = OPTIONS,
  status: unknown = { logged_in: true, host: "mc.example.com" },
  createResult?: Promise<unknown>,
) {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "mc_status") return status instanceof Error ? Promise.reject(status) : Promise.resolve(status);
        if (cmd === "mc_task_options") return Promise.resolve(options);
        if (cmd === "mc_task_create") {
          created.push(args ?? {});
          return createResult ?? Promise.resolve({ id: "new-task", status: "pending" });
        }
        return Promise.resolve({});
      },
    },
  };
}

describe("NewCloudTask", () => {
  it("默认值:免费档选基础模型、公共宿主、devbox 镜像;超档模型禁选", async () => {
    stubShell();
    render(<NewCloudTask onCreated={() => {}} />);
    const model = await screen.findByRole("button", { name: "模型" });
    expect(model.textContent).toContain("基础模型");
    await userEvent.click(model);
    const menu = screen.getByRole("list", { name: "模型" });
    expect((within(menu).getByRole("button", { name: /旗舰模型/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "宿主机" }).textContent).toContain("公共宿主机");
    expect(screen.getByRole("button", { name: "镜像" }).textContent).toContain("devbox");
  });

  // 此前是 disabled + title:daisyUI 的 disabled 按钮带 pointer-events:none,
  // 那条 tooltip 任何内核都弹不出来,有私有宿主机的用户只看到一个灰掉、
  // 点不动、毫无说明的控件
  it("公共模型限公共宿主:触发器仍可点,理由是菜单里一行可见文字,且只列公共宿主", async () => {
    stubShell();
    render(<NewCloudTask onCreated={() => {}} />);
    const host = (await screen.findByRole("button", { name: "宿主机" })) as HTMLButtonElement;
    expect(host.disabled).toBe(false);

    await userEvent.click(host);
    const menu = screen.getByRole("list", { name: "宿主机" });
    expect(within(menu).getByText("公共模型仅支持公共宿主机")).toBeTruthy();
    expect(within(menu).getByRole("button", { name: /公共宿主机/ })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: /my-host/ })).toBeNull();
  });

  it("私有模型解锁宿主机选择;提交带四要素;成功回调", async () => {
    const created: Record<string, unknown>[] = [];
    stubShell(created);
    const onCreated = vi.fn();
    render(<NewCloudTask onCreated={onCreated} />);
    await userEvent.click(await screen.findByRole("button", { name: "模型" }));
    await userEvent.click(within(screen.getByRole("list", { name: "模型" })).getByRole("button", { name: "my-model" }));
    const host = screen.getByRole("button", { name: "宿主机" }) as HTMLButtonElement;
    expect(host.disabled).toBe(false);
    await userEvent.click(host);
    await userEvent.click(within(screen.getByRole("list", { name: "宿主机" })).getByRole("button", { name: "私有机" }));
    await userEvent.type(screen.getByLabelText("任务描述"), "给我修个 bug");
    await userEvent.click(screen.getByText("创建"));
    expect(created).toEqual([
      { req: { content: "给我修个 bug", model_id: "m-mine", host_id: "h-1", image_id: "i-devbox" } },
    ]);
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new-task" }));
  });

  it("创建请求完成前切换服务:丢弃旧服务迟到的 task,不回填 App", async () => {
    let resolveCreate: ((task: unknown) => void) | undefined;
    const pending = new Promise<unknown>((resolve) => {
      resolveCreate = resolve;
    });
    stubShell([], OPTIONS, { logged_in: true, host: "old.example.com" }, pending);
    const onCreated = vi.fn();
    let current = 0;
    const isCurrent = (generation: number) => generation === current;
    const { rerender } = render(
      <McTransportProvider generation={0} isCurrent={isCurrent}>
        <NewCloudTask onCreated={onCreated} />
      </McTransportProvider>,
    );
    await screen.findByRole("button", { name: "模型" });
    await userEvent.type(screen.getByLabelText("任务描述"), "旧服务任务");
    await userEvent.click(screen.getByText("创建"));

    current = 1;
    rerender(
      <McTransportProvider generation={1} isCurrent={isCurrent}>
        <NewCloudTask onCreated={onCreated} />
      </McTransportProvider>,
    );
    await act(async () => resolveCreate?.({ id: "old-task", status: "pending" }));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("默认不关联仓库:提交不带 repo_url/project_id", async () => {
    const created: Record<string, unknown>[] = [];
    stubShell(created);
    render(<NewCloudTask onCreated={() => {}} />);
    expect(await screen.findByRole("button", { name: "关联仓库" })).toBeDefined();
    expect(screen.getByRole("button", { name: "关联仓库" }).textContent).toContain("不关联仓库");
    await userEvent.type(await screen.findByLabelText("任务描述"), "随便聊聊");
    await userEvent.click(screen.getByText("创建"));
    const req = created[0]!.req as Record<string, unknown>;
    expect(req.repo_url).toBeUndefined();
    expect(req.project_id).toBeUndefined();
  });

  it("手输仓库地址:校验后进触发器,提交带 repo_url", async () => {
    const created: Record<string, unknown>[] = [];
    stubShell(created);
    render(<NewCloudTask onCreated={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "关联仓库" }));

    // 非 Git 地址就地拦截,不落到触发器
    await userEvent.type(screen.getByLabelText("手动输入仓库地址"), "not-a-repo");
    await userEvent.click(screen.getByRole("button", { name: "使用" }));
    expect((await screen.findByRole("alert")).textContent).toContain("有效的 Git 地址");

    await userEvent.clear(screen.getByLabelText("手动输入仓库地址"));
    await userEvent.type(screen.getByLabelText("手动输入仓库地址"), "https://github.com/o/repo.git");
    await userEvent.click(screen.getByRole("button", { name: "使用" }));
    expect(screen.getByRole("button", { name: "关联仓库" }).textContent).toContain("repo");

    await userEvent.type(screen.getByLabelText("任务描述"), "改点东西");
    await userEvent.click(screen.getByText("创建"));
    const req = created[0]!.req as Record<string, unknown>;
    expect(req.repo_url).toBe("https://github.com/o/repo.git");
    expect(req.project_id).toBeUndefined();
  });

  it("选云端项目:提交带 project_id 与其 repo_url,并顶掉此前手输的地址", async () => {
    const created: Record<string, unknown>[] = [];
    stubShell(created, {
      ...OPTIONS,
      projects: [{ id: "p1", name: "阿尔法", repo_url: "https://git/o/alpha.git" }],
    });
    render(<NewCloudTask onCreated={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "关联仓库" }));
    await userEvent.type(screen.getByLabelText("手动输入仓库地址"), "https://github.com/o/repo.git");
    await userEvent.click(screen.getByRole("button", { name: "使用" }));

    await userEvent.click(screen.getByRole("button", { name: "关联仓库" }));
    await userEvent.click(screen.getByRole("button", { name: "阿尔法" }));
    expect(screen.getByRole("button", { name: "关联仓库" }).textContent).toContain("阿尔法");

    await userEvent.type(screen.getByLabelText("任务描述"), "接着干");
    await userEvent.click(screen.getByText("创建"));
    expect((created[0]!.req as Record<string, unknown>).project_id).toBe("p1");
    expect((created[0]!.req as Record<string, unknown>).repo_url).toBe("https://git/o/alpha.git");
  });

  it("预选项目(侧栏项目组头「+」入口):触发器直接落在该项目上", async () => {
    stubShell([], { ...OPTIONS, projects: [{ id: "p1", name: "阿尔法", repo_url: "https://git/o/alpha.git" }] });
    render(<NewCloudTask onCreated={() => {}} initialProject={{ id: "p1", name: "阿尔法" }} />);
    expect((await screen.findByRole("button", { name: "关联仓库" })).textContent).toContain("阿尔法");
  });

  // 未连接不是"选项加载失败":恢复动作是去设置里连账号,不是重试。
  // 无条件拉 mc_task_options 只会把壳的 401 原文摊在面板上(旧 UI
  // newtask.tsx:289/916 的 cloudReady 守卫 + 「请先连接」)
  it("未连接 MonkeyCode:不拉选项,给「请先连接」空态与去设置入口", async () => {
    const calls: string[] = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          calls.push(cmd);
          if (cmd === "mc_status") return Promise.resolve({ logged_in: false, host: "mc.example.com" });
          if (cmd === "mc_task_options") return Promise.reject(new Error("401 未登录"));
          return Promise.resolve({});
        },
      },
    };
    const onOpenSettings = vi.fn();
    render(<NewCloudTask onCreated={() => {}} onOpenSettings={onOpenSettings} />);
    expect(await screen.findByText("请先连接 MonkeyCode")).toBeTruthy();
    expect(calls).not.toContain("mc_task_options"); // 明知会 401 就不拉
    expect(screen.queryByText(/401/)).toBeNull(); // 不把壳的原文摊给用户
    expect(screen.queryByLabelText("任务描述")).toBeNull();
    await userEvent.click(screen.getByText("去设置连接"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("mc_status 自己抛错:不敢断言未连接,原因照常外显(不把一切故障粉饰成未连接)", async () => {
    stubShell([], OPTIONS, new Error("shell offline"));
    render(<NewCloudTask onCreated={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("shell offline");
    expect(screen.queryByText("请先连接 MonkeyCode")).toBeNull();
  });

  it("空描述拦截外显", async () => {
    stubShell();
    render(<NewCloudTask onCreated={() => {}} />);
    await screen.findByRole("button", { name: "模型" });
    await userEvent.click(screen.getByText("创建"));
    expect((await screen.findByRole("alert")).textContent).toContain("请填写任务描述");
  });
});
