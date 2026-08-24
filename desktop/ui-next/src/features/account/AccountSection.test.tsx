import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SettingsDraft } from "@/features/settings/settingsForm";
import type { McUsage } from "@/lib/ipc/account";
import { AccountSection } from "./AccountSection";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

type Handler = (args?: Record<string, unknown>) => unknown;

/** 命令级可变桩:handlers 按 cmd 出应答(测试中途可改),未知命令回 null。 */
function stubShell(handlers: Record<string, Handler>) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        const h = handlers[cmd];
        if (!h) return Promise.resolve(null);
        try {
          return Promise.resolve(h(args));
        } catch (e) {
          return Promise.reject(e);
        }
      },
    },
  };
  return { calls };
}

const never = () => new Promise(() => {});
const bzOut = () => ({ logged_in: false, host: "baizhi.cloud" });
const bzIn = () => ({ logged_in: true, host: "baizhi.cloud", profile: { name: "张三" } });
const mcOut = () => ({ logged_in: false, host: "monkeycode-ai.com" });
const mcIn = () => ({ logged_in: true, host: "monkeycode-ai.com", user: { id: "u1", name: "云端用户" } });

const emptyDraft = (): SettingsDraft => ({
  models: [],
  defaultIdx: 0,
  mcps: [],
  kernelEnv: "",
  mcBaseUrl: "",
  mcBasicAuth: "",
  mcLlmBaseUrl: "",
  mcSkipTlsVerify: false,
});

const usageFixture = (): McUsage => ({
  base_url: "https://mc.example",
  wallet: { balance: 12345, daily_token_balance: 1_500_000, daily_token_limit: 3_000_000 },
  subscription: { plan: "pro", expires_at: "2026-12-31T00:00:00Z" },
  checked_in: false,
  invitations: { count: 2, items: [{ id: "i1", name: "甲" }] },
});

describe("账号分区:门与登录面板", () => {
  it("浏览器模式:仅提示「桌面应用可用」,不发任何命令", () => {
    render(<AccountSection />);
    expect(screen.getByRole("alert").textContent).toContain("账号功能仅在桌面应用中可用");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("refreshKey 变化后刷新服务状态并丢弃旧请求的迟到结果", async () => {
    let mcCalls = 0;
    let resolveOld: ((value: ReturnType<typeof mcIn>) => void) | undefined;
    const oldResponse = new Promise<ReturnType<typeof mcIn>>((resolve) => {
      resolveOld = resolve;
    });
    stubShell({
      baizhi_status: bzOut,
      mc_status: () => {
        mcCalls += 1;
        return mcCalls === 1
          ? oldResponse
          : { logged_in: true, host: "new.example.com", user: { id: "u2", name: "新服务用户" } };
      },
      mc_usage: () => null,
    });

    const { rerender } = render(<AccountSection refreshKey={0} />);
    await waitFor(() => expect(mcCalls).toBe(1));
    rerender(<AccountSection refreshKey={1} />);
    await screen.findByText("new.example.com");
    resolveOld?.(mcIn());
    await act(async () => undefined);

    expect(screen.queryByText("monkeycode-ai.com")).toBeNull();
    expect(screen.getByText("new.example.com")).toBeDefined();
  });

  it("服务切换后的状态查询失败时不保留旧服务账号", async () => {
    let mcCalls = 0;
    stubShell({
      baizhi_status: bzOut,
      mc_status: () => {
        mcCalls += 1;
        // 账号 host 用独立值:cn 行自己的域名标签恒在,断言要指向的是
        // 「旧服务账号的 host」而不是行标签
        if (mcCalls === 1) return { logged_in: true, host: "old.example.com", user: { id: "u1", name: "云端用户" } };
        throw new Error("新服务不可达");
      },
      mc_usage: () => null,
    });

    const { rerender } = render(<AccountSection refreshKey={0} />);
    await screen.findByText("old.example.com");
    rerender(<AccountSection refreshKey={1} />);

    await waitFor(() => expect(screen.queryByText("old.example.com")).toBeNull());
    expect(await screen.findByText(/登录状态读取失败:新服务不可达/)).toBeDefined();
  });

  it("未登录默认微信 tab:自动拉码展示二维码与「待扫」提示", async () => {
    stubShell({
      baizhi_status: bzOut,
      mc_status: mcOut,
      baizhi_wechat_start: () => ({ qr: "data:image/jpeg;base64,QQ" }),
      baizhi_wechat_poll: never,
    });
    render(<AccountSection />);
    const img = (await screen.findByAltText("微信扫码登录")) as HTMLImageElement;
    expect(img.src).toBe("data:image/jpeg;base64,QQ");
    expect(await screen.findByText("用微信扫一扫登录")).toBeDefined();
  });

  it("expired:二维码上覆「重新获取」,点击重新拉码", async () => {
    let polls = 0;
    const { calls } = stubShell({
      baizhi_status: bzOut,
      mc_status: mcOut,
      baizhi_wechat_start: () => ({ qr: "data:qr" }),
      baizhi_wechat_poll: () => (++polls === 1 ? { status: "expired" } : never()),
    });
    render(<AccountSection />);
    const retry = await screen.findByRole("button", { name: "重新获取二维码" });
    expect(screen.getByText("二维码已过期")).toBeDefined();
    await userEvent.click(retry);
    await waitFor(() => expect(calls.filter((c) => c.cmd === "baizhi_wechat_start")).toHaveLength(2));
    expect(await screen.findByText("用微信扫一扫登录")).toBeDefined();
  });

  it("扫码 ok:刷新登录态、顺带桥接 MonkeyCode,且两路自动同步(登录即同步,不用手点)", async () => {
    let statusCalls = 0;
    let mcConnected = false;
    const { calls } = stubShell({
      baizhi_status: () => (++statusCalls === 1 ? bzOut() : bzIn()),
      mc_status: () => (mcConnected ? mcIn() : mcOut()),
      baizhi_wechat_start: () => ({ qr: "data:qr" }),
      baizhi_wechat_poll: () => ({ status: "ok" }),
      mc_login: () => {
        mcConnected = true;
        return { ok: true };
      },
      mc_usage: () => null,
      baizhi_sync: () => ({ models: [{ name: "g", base_url: "https://g", api_key: "k", model: "g" }], mcp_servers: {}, key_created: false }),
      mc_models_sync: () => ({ models: [{ name: "m", base_url: "https://m", api_key: "k", model: "m", source: "monkeycode" }] }),
    });
    render(<AccountSection />);
    expect(await screen.findByText("张三")).toBeDefined(); // 百智云卡已登录形态
    expect(await screen.findByText("云端用户")).toBeDefined(); // 桥接成功,MC 卡已连
    expect(calls.some((c) => c.cmd === "mc_login")).toBe(true);
    // 登录真实事件自动起两路同步(旧 UI 用户拍板行为;打开设置读到既有
    // 登录态不触发,由「已登录:同步按钮」用例的无自动同步前提反向钉住)
    await waitFor(() => expect(calls.some((c) => c.cmd === "baizhi_sync")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_models_sync")).toBe(true));
  });
});

describe("登录即自动同步的信号边沿", () => {
  // McCard 的自动同步守卫读 connected 却只依赖 autoSyncToken:两者不在同一次
  // 提交里落地时(这里让 mc_status 在桥接那一轮失败,connected 晚到),effect
  // 早就跑完了,这一路同步永远不会发生 —— 用户连上了却没有会员模型,还查无
  // 对证。依赖补上 connected 后,连接态一到就补发(同一个 token 只发一次)
  it("连接态晚于同步信号落地(桥接后状态刷新失败,重试才连上):会员同步照样补发", async () => {
    let bzIn_ = false;
    let mcConnected = false;
    const gate = { mcStatusOk: false };
    const { calls } = stubShell({
      baizhi_status: () => (bzIn_ ? bzIn() : bzOut()),
      mc_status: () => {
        if (!gate.mcStatusOk) throw new Error("网络抖动");
        return mcConnected ? mcIn() : mcOut();
      },
      baizhi_wechat_start: () => ({ qr: "data:qr" }),
      baizhi_wechat_poll: () => {
        bzIn_ = true;
        return { status: "ok" };
      },
      mc_login: () => {
        mcConnected = true;
        return { ok: true };
      },
      mc_usage: () => null,
      baizhi_sync: () => ({ models: [{ name: "g", base_url: "https://g", api_key: "k", model: "g" }], mcp_servers: {}, key_created: false }),
      mc_models_sync: () => ({ models: [{ name: "m", base_url: "https://m", api_key: "k", model: "m", source: "monkeycode" }] }),
    });
    render(<AccountSection />);
    // 登录 → 桥接成功,但这一轮 mc_status 挂了:token 已 bump,connected 还是 false
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_login")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.cmd === "baizhi_sync")).toBe(true));
    expect(calls.some((c) => c.cmd === "mc_models_sync")).toBe(false);

    // 状态恢复后重试 → 连接态这才落地
    gate.mcStatusOk = true;
    await userEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("云端用户")).toBeDefined();
    await waitFor(() => expect(calls.filter((c) => c.cmd === "mc_models_sync")).toHaveLength(1));
  });
});

describe("短信验证码登录", () => {
  const smsHandlers = () => ({
    baizhi_status: bzOut,
    mc_status: mcOut,
    baizhi_wechat_start: never, // 微信 tab 初始挂载的拉码挂起即可
    baizhi_send_code: () => ({ ok: true }),
  });

  it("手机号无效:就地报错,不发 baizhi_send_code", async () => {
    const { calls } = stubShell(smsHandlers());
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("tab", { name: "短信" }));
    await userEvent.type(screen.getByRole("textbox", { name: "手机号" }), "123");
    await userEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(screen.getByRole("alert").textContent).toContain("请输入有效的手机号");
    expect(calls.some((c) => c.cmd === "baizhi_send_code")).toBe(false);
  });

  it("发码成功:按钮进入 60s 倒计时禁用,读秒归零后恢复可点", async () => {
    const { calls } = stubShell(smsHandlers());
    render(<AccountSection />);
    // 导航与输入走真时钟(findBy/waitFor 不吃假时钟),读秒段再切假时钟
    await userEvent.click(await screen.findByRole("tab", { name: "短信" }));
    await userEvent.type(screen.getByRole("textbox", { name: "手机号" }), "13800000000");

    vi.useFakeTimers();
    // fireEvent(同步)而非 userEvent:后者内部靠 setTimeout 排步,假时钟下会悬死
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await act(async () => {}); // 冲掉发码 promise 链(壳应答→setCountdown)

    expect(calls.filter((c) => c.cmd === "baizhi_send_code").map((c) => c.args)).toEqual([{ phone: "13800000000" }]);
    const at60 = screen.getByRole("button", { name: "60s" }) as HTMLButtonElement;
    expect(at60.disabled).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: "59s" })).toBeDefined();
    for (let i = 0; i < 59; i++) act(() => vi.advanceTimersByTime(1000));
    const restored = screen.getByRole("button", { name: "获取验证码" }) as HTMLButtonElement;
    expect(restored.disabled).toBe(false);
  });

  it("登录成功:baizhi_login 携带手机号与验证码,并顺带桥接 MonkeyCode", async () => {
    let loggedIn = false;
    let mcConnected = false;
    const { calls } = stubShell({
      ...smsHandlers(),
      baizhi_status: () => (loggedIn ? bzIn() : bzOut()),
      mc_status: () => (mcConnected ? mcIn() : mcOut()),
      baizhi_login: () => {
        loggedIn = true;
        return { ok: true };
      },
      mc_login: () => {
        mcConnected = true;
        return { ok: true };
      },
      mc_usage: () => null,
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("tab", { name: "短信" }));
    await userEvent.type(screen.getByRole("textbox", { name: "手机号" }), "13800000000");
    await userEvent.type(screen.getByRole("textbox", { name: "短信验证码" }), "654321");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("张三")).toBeDefined();
    expect(calls.find((c) => c.cmd === "baizhi_login")?.args).toEqual({ phone: "13800000000", code: "654321" });
    expect(calls.some((c) => c.cmd === "mc_login")).toBe(true);
  });
  it("百智登录后的旧状态刷新跨服务切换时不得继续桥接 MonkeyCode", async () => {
    let bzCalls = 0;
    let mcCalls = 0;
    let resolveOldBz: ((value: ReturnType<typeof bzIn>) => void) | undefined;
    let resolveOldMc: ((value: ReturnType<typeof mcOut>) => void) | undefined;
    const oldBz = new Promise<ReturnType<typeof bzIn>>((resolve) => {
      resolveOldBz = resolve;
    });
    const oldMc = new Promise<ReturnType<typeof mcOut>>((resolve) => {
      resolveOldMc = resolve;
    });
    const { calls } = stubShell({
      baizhi_status: () => {
        bzCalls += 1;
        if (bzCalls === 1) return bzOut();
        if (bzCalls === 2) return oldBz;
        return bzIn();
      },
      mc_status: () => {
        mcCalls += 1;
        if (mcCalls === 1) return mcOut();
        if (mcCalls === 2) return oldMc;
        return mcOut();
      },
      baizhi_wechat_start: never,
      baizhi_send_code: () => ({ ok: true }),
      baizhi_login: () => ({ ok: true }),
      mc_login: () => ({ ok: true }),
    });

    const { rerender } = render(<AccountSection refreshKey={0} />);
    await userEvent.click(await screen.findByRole("tab", { name: "短信" }));
    await userEvent.type(screen.getByRole("textbox", { name: "手机号" }), "13800000000");
    await userEvent.type(screen.getByRole("textbox", { name: "短信验证码" }), "654321");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    await waitFor(() => expect(bzCalls).toBe(2));

    rerender(<AccountSection refreshKey={1} />);
    await waitFor(() => expect(bzCalls).toBe(3));
    resolveOldBz?.(bzIn());
    resolveOldMc?.(mcOut());
    await act(async () => undefined);

    expect(calls.some((c) => c.cmd === "mc_login")).toBe(false);
  });
});

describe("MonkeyCode 账号密码登录入口", () => {
  it("全未登录(国内版):纯登录页——三 tab 齐备,无组头/「未连接」壳/「连接」死钮,百智云组不出现", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut, baizhi_wechat_start: never });
    render(<AccountSection />);
    // 微信/短信是经百智云 OAuth 登录 MonkeyCode 的方式,与账密同卡同 tab 序
    expect(await screen.findByRole("tab", { name: "微信扫码" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "短信" })).toBeDefined();
    // 登录前没有账号可陈列:不摆「MonkeyCode 云端」组头与「未连接」账号卡壳
    expect(screen.queryByText("MonkeyCode 云端")).toBeNull();
    expect(screen.queryByText("未连接")).toBeNull();
    expect(screen.queryByRole("button", { name: "连接 MonkeyCode 云端" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "密码" }));
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeDefined();
    // 两头都未登录时百智云组不出现:登录职责已收进登录页
    expect(screen.queryByText("百智云服务")).toBeNull();
  });

  it("百智云已登录、MC 未连:说明行 + 「连接」主钮,账密入口仍在同一张卡", async () => {
    stubShell({ baizhi_status: bzIn, mc_status: mcOut, mc_usage: () => null });
    render(<AccountSection />);
    expect(await screen.findByRole("button", { name: "连接 MonkeyCode 云端" })).toBeDefined();
    // 按钮的存在理由外显:拿现有百智云会话一键换 MonkeyCode 会话
    expect(screen.getByText(/已登录百智云,可用当前账号一键连接/)).toBeDefined();
    expect(screen.getByRole("button", { name: "使用 MonkeyCode 账号密码登录" })).toBeDefined();
  });

  it("旧服务连接流程跨过状态刷新后不得触发新服务会员同步", async () => {
    let statusCalls = 0;
    let resolveOldRefresh: ((value: ReturnType<typeof mcIn>) => void) | undefined;
    const oldRefresh = new Promise<ReturnType<typeof mcIn>>((resolve) => {
      resolveOldRefresh = resolve;
    });
    const { calls } = stubShell({
      baizhi_status: bzIn,
      mc_status: () => {
        statusCalls += 1;
        if (statusCalls === 1) return mcOut();
        if (statusCalls === 2) return oldRefresh;
        return mcIn();
      },
      mc_login: () => ({ ok: true }),
      mc_usage: () => null,
      mc_models_sync: () => ({ models: [{ name: "新服务模型" }] }),
    });

    const { rerender } = render(<AccountSection refreshKey={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "连接 MonkeyCode 云端" }));
    await waitFor(() => expect(statusCalls).toBe(2));
    rerender(<AccountSection refreshKey={1} />);
    await screen.findByText("云端用户");
    resolveOldRefresh?.(mcIn());
    await act(async () => undefined);

    expect(calls.some((c) => c.cmd === "mc_models_sync")).toBe(false);
  });

  it("空提交拦截;正确提交 mc_password_login 原样携带 email/password", async () => {
    let mcConnected = false;
    const { calls } = stubShell({
      baizhi_status: bzOut,
      mc_status: () => (mcConnected ? mcIn() : mcOut()),
      baizhi_wechat_start: never,
      mc_password_login: () => {
        mcConnected = true;
        return { ok: true };
      },
      mc_usage: () => null,
      mc_models_sync: () => ({ models: [{ name: "m", base_url: "https://m", api_key: "k", model: "m", source: "monkeycode" }] }),
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("tab", { name: "密码" }));

    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(screen.getByRole("alert").textContent).toContain("请输入邮箱和密码");
    expect(calls.some((c) => c.cmd === "mc_password_login")).toBe(false);

    await userEvent.type(screen.getByRole("textbox", { name: "邮箱" }), "a@b.c");
    await userEvent.type(screen.getByLabelText("密码"), "p w");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("云端用户")).toBeDefined();
    expect(calls.find((c) => c.cmd === "mc_password_login")?.args).toEqual({ email: "a@b.c", password: "p w" });
    // MC 已连、百智云未登录:登录 tabs 收起,百智云组降级为可选登录入口
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: "登录百智云" })).toBeDefined();
    // 账密直连同样是登录真实事件:会员模型自动同步
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_models_sync")).toBe(true));
  });
});

describe("百智云增值登录(国内版,MC 已连)", () => {
  it("可选入口展开后仅微信/短信(登的是百智云,不带账密 tab);登录后不重复桥接", async () => {
    let bzLogged = false;
    const { calls } = stubShell({
      baizhi_status: () => (bzLogged ? bzIn() : bzOut()),
      mc_status: mcIn,
      mc_usage: () => null,
      baizhi_wechat_start: never,
      baizhi_send_code: () => ({ ok: true }),
      baizhi_login: () => {
        bzLogged = true;
        return { ok: true };
      },
      mc_login: () => ({ ok: true }),
      baizhi_sync: () => ({ models: [{}], mcp_servers: {}, key_created: false }),
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("button", { name: "登录百智云" }));
    expect(screen.queryByRole("tab", { name: "密码" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "短信" }));
    await userEvent.type(screen.getByRole("textbox", { name: "手机号" }), "13800000000");
    await userEvent.type(screen.getByRole("textbox", { name: "短信验证码" }), "654321");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("张三")).toBeDefined();
    // 已连不打扰:这条路只为模型/MCP 同步,不得重桥接换掉现有 MC 账号
    expect(calls.some((c) => c.cmd === "mc_login")).toBe(false);
  });
});

describe("已登录:用量面板/签到/同步/断开", () => {
  const connectedHandlers = (usage: { current: McUsage }) => ({
    baizhi_status: bzIn,
    mc_status: mcIn,
    mc_usage: () => usage.current,
  });

  it("私有服务链接使用完整 base_url,保留 http、端口与部署路径", async () => {
    const opened: string[] = [];
    stubShell({
      baizhi_status: bzOut,
      mc_status: () => ({
        logged_in: true,
        host: "localhost",
        base_url: "http://localhost:8000/private/team-a",
        user: { id: "u1", name: "云端用户" },
      }),
      mc_usage: () => null,
      "plugin:opener|open_url": (args) => {
        opened.push(String(args?.url));
      },
    });
    render(<AccountSection savedMcBaseUrl="http://localhost:8000/private/team-a" />);
    await userEvent.click(await screen.findByText("localhost:8000/private/team-a"));
    expect(opened).toEqual(["http://localhost:8000/private/team-a"]);
  });

  it("身份副行:主机名 + 用户 ID(长串按 头8…尾6 掩码),点击复制完整原值", async () => {
    const longId = "5f8a12c3-9b4d-4e7a-8c1f-0a2b3c4d9d21";
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    stubShell({
      baizhi_status: bzIn,
      mc_status: () => ({ logged_in: true, host: "monkeycode-ai.com", user: { id: longId, name: "云端用户" } }),
      mc_usage: () => null,
    });
    render(<AccountSection />);
    const btn = await screen.findByRole("button", { name: "复制用户 ID" });
    expect(btn.textContent).toBe("5f8a12c3...4d9d21");
    expect(btn.getAttribute("title")).toBe(`用户 ID:${longId}(点击复制)`);

    await userEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith(longId); // 复制的是完整原值,不是掩码
    expect(await screen.findByRole("button", { name: "用户 ID 已复制" })).toBeDefined();
  });

  it("用量面板:会员档 badge、有效期、额度 progress、积分、邀请;签到成功后刷为已签", async () => {
    const usage = { current: usageFixture() };
    const { calls } = stubShell({
      ...connectedHandlers(usage),
      mc_checkin: () => {
        usage.current = {
          ...usageFixture(),
          checked_in: true,
          wallet: { balance: 112345, daily_token_balance: 1_500_000, daily_token_limit: 3_000_000 },
        };
        return { ok: true };
      },
    });
    render(<AccountSection />);
    expect(await screen.findByText("专业会员")).toBeDefined();
    expect(screen.getByText("有效期至 2026-12-31")).toBeDefined();
    const bar = screen.getByRole("progressbar") as HTMLProgressElement;
    expect(bar.value).toBe(1_500_000);
    expect(bar.max).toBe(3_000_000);
    expect(screen.getByText("剩余 1.5M / 3.0M")).toBeDefined();
    // 积分改 stats 大数值卡:标题与数值分节点
    expect(screen.getByText("积分")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    // 邀请瓷片:标题与人数分节点(2026-08-16 服务列表布局)
    expect(screen.getByText("已邀请")).toBeDefined();
    expect(screen.getByText("2 人")).toBeDefined();
    // 邀请链接收进复制按钮(title 露全链接),不再明文铺链接
    expect(screen.getByTitle("https://mc.example/?ic=u1")).toBeDefined();
    expect(screen.getByRole("button", { name: "复制邀请链接" })).toBeDefined();

    // 签到三态:可签 → 成功后刷新为「今日已签到」禁用;积分随重拉一起更新
    await userEvent.click(screen.getByRole("button", { name: "签到 +100" }));
    expect(calls.some((c) => c.cmd === "mc_checkin")).toBe(true);
    const done = (await screen.findByRole("button", { name: "今日已签到" })) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(screen.getByText("112")).toBeDefined();
  });

  it("签到失败(重复签到等业务提示):就地报错,按钮不进入已签态", async () => {
    const usage = { current: usageFixture() };
    stubShell({
      ...connectedHandlers(usage),
      mc_checkin: () => {
        throw new Error("今日已签到,请明天再来");
      },
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("button", { name: "签到 +100" }));
    expect((await screen.findByRole("alert")).textContent).toContain("今日已签到,请明天再来");
    expect(screen.getByRole("button", { name: "签到 +100" })).toBeDefined();
  });

  it("服务切换前发出的会员模型同步迟到后不得并入新服务配置", async () => {
    let resolveOld: ((value: { models: Array<Record<string, unknown>> }) => void) | undefined;
    const oldSync = new Promise<{ models: Array<Record<string, unknown>> }>((resolve) => {
      resolveOld = resolve;
    });
    const usage = { current: usageFixture() };
    const onSyncResult = vi.fn();
    stubShell({
      ...connectedHandlers(usage),
      mc_models_sync: () => oldSync,
    });

    const { rerender } = render(<AccountSection refreshKey={0} onSyncResult={onSyncResult} />);
    await userEvent.click(await screen.findByRole("button", { name: "同步会员模型" }));
    expect((screen.getByRole("button", { name: "断开连接" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<AccountSection refreshKey={1} onSyncResult={onSyncResult} />);
    resolveOld?.({ models: [{ name: "旧服务模型", source: "monkeycode" }] });
    await act(async () => undefined);

    expect(onSyncResult).not.toHaveBeenCalled();
    expect(((await screen.findByRole("button", { name: "同步会员模型" })) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("同步中...")).toBeNull();
  });

  it("同步按钮:baizhi_sync 携带 knownKeys,mc_models_sync 结果提示条数与 note", async () => {
    const usage = { current: usageFixture() };
    const { calls } = stubShell({
      ...connectedHandlers(usage),
      baizhi_sync: () => ({
        models: [{}, {}, {}],
        mcp_servers: { "baizhi-toolkit": {} },
        key_created: false,
        notes: [],
      }),
      mc_models_sync: () => ({ models: [{}, {}], notes: ["1 条模型使用了不支持的协议,已跳过"] }),
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("button", { name: "同步模型与 MCP" }));
    expect(calls.find((c) => c.cmd === "baizhi_sync")?.args).toEqual({ knownKeys: [] });
    expect((await screen.findByText(/已获取 3 个模型、1 个 MCP 配置/)).textContent).toContain("保存后生效");

    await userEvent.click(screen.getByRole("button", { name: "同步会员模型" }));
    expect(calls.some((c) => c.cmd === "mc_models_sync")).toBe(true);
    expect((await screen.findByText(/已获取 2 个会员模型/)).textContent).toContain("不支持的协议");
  });

  // 契约见 desktop/src/baizhi/sync.rs ensure_api_key:壳先拿 knownKeys 去网关
  // 匹配复用,匹配不上才新建一把。恒传空数组 = 每同步一次就在用户网关账号里
  // 凭空多一把密钥,而表单里明明就握着可用的那把
  it("baizhi_sync 携带草稿里握着的网关密钥(只挑 sk- 且去重),不再恒传空数组", async () => {
    const usage = { current: usageFixture() };
    const { calls } = stubShell({
      ...connectedHandlers(usage),
      baizhi_sync: () => ({ models: [{}], mcp_servers: {}, key_created: false }),
    });
    const draft: SettingsDraft = {
      ...emptyDraft(),
      models: [
        { name: "a", provider: "anthropic", base_url: "https://a", api_key: " sk-live ", model: "m" },
        { name: "b", provider: "anthropic", base_url: "https://b", api_key: "sk-live", model: "m" }, // 同一把,去重
        { name: "c", provider: "anthropic", base_url: "https://c", api_key: "hf_xxx", model: "m" }, // 非网关密钥
        { name: "d", provider: "anthropic", base_url: "https://d", api_key: "", model: "m" },
      ],
    };
    render(<AccountSection draft={draft} onDraft={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "同步模型与 MCP" }));
    expect(calls.find((c) => c.cmd === "baizhi_sync")?.args).toEqual({ knownKeys: ["sk-live"] });
  });

  // 「已获取 0 个…保存后生效」读起来像成功,用户就等着模型出现;而且空集合
  // 并入本是 no-op,却会捎带触发一次自动保存(写盘 + 重启引擎)
  it("一条都没拉到:按失败外显(不是「已获取 0 个」),也不把空结果并入草稿", async () => {
    const usage = { current: usageFixture() };
    const onSyncResult = vi.fn();
    stubShell({
      ...connectedHandlers(usage),
      baizhi_sync: () => ({ models: [], mcp_servers: {}, key_created: false, notes: ["未开通 Agent 工具包"] }),
      mc_models_sync: () => ({ models: [], notes: ["账号无会员权益"] }),
    });
    render(<AccountSection onSyncResult={onSyncResult} />);

    await userEvent.click(await screen.findByRole("button", { name: "同步模型与 MCP" }));
    const bzMsg = await screen.findByText(/没有拉取到可用的模型/);
    expect(bzMsg.getAttribute("role")).toBe("alert"); // 失败语义,不是 status
    expect(bzMsg.textContent).toContain("未开通 Agent 工具包"); // 内核诊断照样外显
    expect(screen.queryByText(/已获取 0 个/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "同步会员模型" }));
    const mcMsg = await screen.findByText(/没有可同步的会员模型/);
    expect(mcMsg.getAttribute("role")).toBe("alert");
    expect(mcMsg.textContent).toContain("账号无会员权益");
    expect(onSyncResult).not.toHaveBeenCalled();
  });

  it("断开连接:只调用壳内原子 mc_disconnect,断开后回连接入口", async () => {
    let mcConnected = true;
    const usage = { current: usageFixture() };
    const { calls } = stubShell({
      baizhi_status: bzIn,
      mc_status: () => (mcConnected ? mcIn() : mcOut()),
      mc_usage: () => usage.current,
      mc_disconnect: () => {
        mcConnected = false;
        return { ok: true };
      },
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("button", { name: "断开连接" }));
    expect(await screen.findByRole("button", { name: "连接 MonkeyCode 云端" })).toBeDefined();
    expect(calls.filter((c) => c.cmd === "mc_disconnect")).toHaveLength(1);
  });

  it("服务切换时壳取消旧断开,UI 不刷新新服务状态", async () => {
    let resolveDisconnect: (() => void) | undefined;
    const disconnect = new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    });
    const usage = { current: usageFixture() };
    const { calls } = stubShell({
      ...connectedHandlers(usage),
      mc_disconnect: async () => {
        await disconnect;
        return { ok: false, cancelled: true };
      },
    });

    const { rerender } = render(<AccountSection refreshKey={0} />);
    await userEvent.click(await screen.findByRole("button", { name: "断开连接" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_disconnect")).toBe(true));
    rerender(<AccountSection refreshKey={1} />);
    resolveDisconnect?.();
    await act(async () => undefined);

    expect(calls.filter((c) => c.cmd === "mc_disconnect")).toHaveLength(1);
  });

  it("断开时吊销失败:壳仍完成登出并把 warning 外显", async () => {
    let mcConnected = true;
    const usage = { current: usageFixture() };
    const { calls } = stubShell({
      baizhi_status: bzIn,
      mc_status: () => (mcConnected ? mcIn() : mcOut()),
      mc_usage: () => usage.current,
      mc_disconnect: () => {
        mcConnected = false;
        return { ok: true, warning: "网络不可达" };
      },
    });
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("button", { name: "断开连接" }));
    expect(await screen.findByRole("button", { name: "连接 MonkeyCode 云端" })).toBeDefined();
    expect(calls.map((c) => c.cmd)).toContain("mc_disconnect");
    expect((await screen.findByRole("alert")).textContent).toContain("网络不可达");
  });
});

describe("服务版本选择", () => {
  it("默认国内版;选国际版写入官方国际地址并清空私有化随行配置", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut });
    let draft: SettingsDraft = { ...emptyDraft(), mcBasicAuth: "user:pass", mcLlmBaseUrl: "https://llm.old/v1" };
    const onDraft = (up: (d: SettingsDraft) => SettingsDraft) => {
      draft = up(draft);
    };
    render(<AccountSection draft={draft} onDraft={onDraft} />);
    expect(((await screen.findByRole("radio", { name: "国内版" })) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "国际版" }));
    expect(draft.mcBaseUrl).toBe("https://monkeycode-ai.net");
    expect(draft.mcBasicAuth).toBe("");
    expect(draft.mcLlmBaseUrl).toBe("");
  });

  it("存量私有地址:默认选中私有化且字段可见,编辑写回草稿", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut });
    let draft: SettingsDraft = { ...emptyDraft(), mcBaseUrl: "https://self.host" };
    const onDraft = (up: (d: SettingsDraft) => SettingsDraft) => {
      draft = up(draft);
    };
    render(<AccountSection draft={draft} onDraft={onDraft} />);
    expect(((await screen.findByRole("radio", { name: "私有化部署" })) as HTMLInputElement).checked).toBe(true);
    const input = screen.getByLabelText("模型请求地址(可选)");
    await userEvent.type(input, "x");
    expect(draft.mcLlmBaseUrl).toBe("x");
  });

  it("私有 A 改成私有 B 或更换 Basic 后,保存完成前不得显示旧服务登录表单", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut });
    const draft: SettingsDraft = {
      ...emptyDraft(),
      mcBaseUrl: "http://localhost:9000/team-b",
      mcBasicAuth: "b:secret",
    };
    const props = {
      draft,
      onDraft: () => {},
      savedMcBaseUrl: "http://localhost:8000/team-a",
      savedMcBasicAuth: "a:secret",
    };
    const { rerender } = render(<AccountSection {...props} />);
    await screen.findByRole("radio", { name: "私有化部署" });
    expect(screen.queryByRole("textbox", { name: "邮箱" })).toBeNull();
    expect(screen.getByText(/填写服务地址并保存后登录/)).toBeDefined();

    rerender(
      <AccountSection
        {...props}
        savedMcBaseUrl={draft.mcBaseUrl}
        savedMcBasicAuth={draft.mcBasicAuth}
      />,
    );
    expect(await screen.findByRole("textbox", { name: "邮箱" })).toBeDefined();
  });

  it("官方档不露私有化字段;选私有化展开字段且不清用户草稿", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut });
    let draft: SettingsDraft = emptyDraft();
    const onDraft = (up: (d: SettingsDraft) => SettingsDraft) => {
      draft = up(draft);
    };
    render(<AccountSection draft={draft} onDraft={onDraft} />);
    await screen.findByRole("radio", { name: "国内版" });
    expect(screen.queryByLabelText("服务地址")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "私有化部署" }));
    expect(screen.getByLabelText("服务地址")).toBeDefined();
    expect(draft.mcBaseUrl).toBe(""); // 地址留给用户填,选中动作不写草稿
    // 登录卡同步撤下国内版 tabs,提示先填地址再保存
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText(/填写服务地址并保存后登录/)).toBeDefined();
  });

  it("从官方版切私有化:不碰草稿(保存条不弹),官方地址不回显进字段,不误报「版本切换未生效」", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut });
    let draft: SettingsDraft = { ...emptyDraft(), mcBaseUrl: "https://monkeycode-ai.net" };
    const onDraft = vi.fn((up: (d: SettingsDraft) => SettingsDraft) => {
      draft = up(draft);
    });
    render(<AccountSection draft={draft} onDraft={onDraft} savedMcBaseUrl="https://monkeycode-ai.net" />);
    await userEvent.click(await screen.findByRole("radio", { name: "私有化部署" }));

    expect(onDraft).not.toHaveBeenCalled(); // 光点选不写草稿,表单不脏
    expect((screen.getByLabelText("服务地址") as HTMLInputElement).value).toBe(""); // 官方地址不预填误导
    expect(screen.queryByText(/版本切换未生效/)).toBeNull(); // 「重试」兜底只留给官方版落盘失败
    expect(screen.getByText(/填写服务地址并保存后登录/)).toBeDefined();
  });

  it("点选国际版即自动落盘:立即触发保存并撤下微信码,私有化不自动落盘", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut, baizhi_wechat_start: never });
    let draft: SettingsDraft = emptyDraft();
    const onDraft = (up: (d: SettingsDraft) => SettingsDraft) => {
      draft = up(draft);
    };
    const onApplyDraft = vi.fn();
    render(<AccountSection draft={draft} onDraft={onDraft} savedMcBaseUrl="" onApplyDraft={onApplyDraft} />);
    expect(await screen.findByRole("tab", { name: "微信扫码" })).toBeDefined();
    await userEvent.click(screen.getByRole("radio", { name: "国际版" }));
    // 点选即保存生效(2026-08-15 用户定案:不再有「保存并切换」一步)
    expect(onApplyDraft).toHaveBeenCalledWith(
      expect.objectContaining({ mcBaseUrl: "https://monkeycode-ai.net", mcBasicAuth: "", mcLlmBaseUrl: "" }),
    );
    // 形态立即跟选择走,落盘期间不给旧服务的登录表单
    expect(screen.queryByRole("tab")).toBeNull();

    // 私有化要先填地址,点选不自动落盘(交给字段下的「保存」钮)
    onApplyDraft.mockClear();
    await userEvent.click(screen.getByRole("radio", { name: "私有化部署" }));
    expect(onApplyDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存生效" })).toBeDefined();
  });

  it("已登录:列表保留,其它服务给「切换到此服务」而非 radio", async () => {
    stubShell({ baizhi_status: bzIn, mc_status: mcIn, mc_usage: () => null });
    render(<AccountSection draft={emptyDraft()} onDraft={() => {}} />);
    await screen.findByText("云端用户");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getAllByRole("button", { name: "切换到此服务" })).toHaveLength(2);
    expect(screen.getByText("切换后需重新登录并同步会员模型")).toBeDefined();
  });

  it("切换到此服务:先由壳原子断开,再落盘切换", async () => {
    let mcConnected = true;
    const { calls } = stubShell({
      baizhi_status: bzOut,
      mc_status: () => (mcConnected ? mcIn() : mcOut()),
      mc_usage: () => null,
      mc_disconnect: () => {
        mcConnected = false;
        return { ok: true };
      },
      baizhi_wechat_start: never,
    });
    let draft: SettingsDraft = emptyDraft();
    const onDraft = (up: (d: SettingsDraft) => SettingsDraft) => {
      draft = up(draft);
    };
    const onApplyDraft = vi.fn();
    render(<AccountSection draft={draft} onDraft={onDraft} onApplyDraft={onApplyDraft} />);
    await screen.findByText("云端用户");

    // 行序 cn/intl/private,cn 已连——第一个切换钮是国际版行
    await userEvent.click(screen.getAllByRole("button", { name: "切换到此服务" })[0]!);
    await waitFor(() =>
      expect(onApplyDraft).toHaveBeenCalledWith(expect.objectContaining({ mcBaseUrl: "https://monkeycode-ai.net" })),
    );
    const names = calls.map((c) => c.cmd);
    expect(names.indexOf("mc_disconnect")).toBeGreaterThanOrEqual(0);
  });

  it("拿不到草稿(浏览器只读/配置载入失败)时版本选择器不渲染,登录页照常", async () => {
    stubShell({ baizhi_status: bzOut, mc_status: mcOut });
    render(<AccountSection />);
    await screen.findByRole("tab", { name: "微信扫码" });
    expect(screen.queryByRole("radio")).toBeNull();
  });
});

describe("非国内版的登录方式裁剪", () => {
  it("国际版:无微信/短信 tab、无「连接」桥接钮,仅账密表单;百智云组整组隐藏", async () => {
    stubShell({ baizhi_status: bzIn, mc_status: mcOut });
    render(<AccountSection savedMcBaseUrl="https://monkeycode-ai.net" />);
    await screen.findByRole("textbox", { name: "邮箱" });
    expect(screen.queryByRole("button", { name: "连接 MonkeyCode 云端" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeDefined();
    // 国际版未接百智云:即便存在旧百智云会话,增值组也整组隐藏
    expect(screen.queryByText("百智云服务")).toBeNull();
    expect(screen.queryByText("张三")).toBeNull();
  });

  it("私有化:仅账密登录、百智云已登录也不出桥接钮;百智云服务组保留(同步仍可用)", async () => {
    stubShell({ baizhi_status: bzIn, mc_status: mcOut, mc_usage: () => null });
    render(<AccountSection savedMcBaseUrl="https://self.host" />);
    await screen.findByRole("textbox", { name: "邮箱" });
    expect(screen.queryByRole("button", { name: "连接 MonkeyCode 云端" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(await screen.findByText("张三")).toBeDefined();
    expect(screen.getByRole("button", { name: "同步模型与 MCP" })).toBeDefined();
  });
});
