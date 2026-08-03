// 云端文件页:控制流列目录(注入假控制流)、目录导航、点行看正文、上传入口条件。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { b64encode } from "@/lib/protocol/codec";
import type { CloudControl } from "@/lib/cloud/control";
import { resetEscLayersForTest } from "@/lib/util/escLayer";
import { CloudFiles, fmtSize } from "./CloudFiles";

afterEach(() => resetEscLayersForTest());

function fakeControl(): { ctl: CloudControl; calls: { kind: string; payload?: Record<string, unknown> }[] } {
  const calls: { kind: string; payload?: Record<string, unknown> }[] = [];
  const byDir: Record<string, unknown[]> = {
    "": [
      { name: "src", path: "src", entry_mode: 4 },
      { name: "README.md", path: "README.md", entry_mode: 1, size: 2048 },
      { name: ".git", path: ".git", entry_mode: 4 }, // 应被过滤
    ],
    src: [{ name: "main.ts", path: "src/main.ts", entry_mode: 1, size: 10 }],
  };
  const ctl: CloudControl = {
    call<T>(kind: string, payload?: Record<string, unknown>): Promise<T> {
      calls.push({ kind, payload });
      if (kind === "repo_file_changes") {
        return Promise.resolve({ changes: [{ path: "src/main.ts", status: "M", additions: 3, deletions: 1 }] } as T);
      }
      if (kind === "repo_file_diff") {
        return Promise.resolve({ diff: "@@ -1 +1 @@\n-old\n+new" } as T);
      }
      if (kind === "repo_read_file") {
        // 后端 RepoReadFile.Content 是 []byte,JSON 里即 base64
        return Promise.resolve({ content: b64encode("# 项目说明\nhello") } as T);
      }
      const dir = (payload?.path as string) ?? "";
      return Promise.resolve({ files: byDir[dir] ?? [] } as T);
    },
    revive: vi.fn(),
    close: vi.fn(),
    isClosed: () => false,
  };
  return { ctl, calls };
}

/** 注入面:借来的连接由宿主持有,组件不许关它。 */
const lend = (ctrl: CloudControl, release = () => {}) => () => ({ ctrl, release });

describe("CloudFiles", () => {
  it("列目录:目录在前排序、.git 过滤、点目录下钻、返回上级", async () => {
    const { ctl, calls } = fakeControl();
    render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(ctl)} />);
    await screen.findByText("README.md");
    expect(screen.queryByText(".git")).toBeNull();
    expect(calls[0]).toMatchObject({ kind: "repo_file_list", payload: { path: "", glob_pattern: "*", include_hidden: true } });
    await userEvent.click(screen.getByText("src"));
    await screen.findByText("main.ts");
    expect(calls.at(-1)?.payload).toMatchObject({ path: "src" });
    await userEvent.click(screen.getByText("返回上级"));
    await screen.findByText("README.md");
  });

  it("无 vmId(VM 未就绪/已结束):无上传与下载入口", async () => {
    const { ctl } = fakeControl();
    render(<CloudFiles taskId="t1" borrowControl={lend(ctl)} />);
    await screen.findByText("README.md");
    expect(screen.queryByText("上传文件")).toBeNull();
    expect(screen.queryByText("下载")).toBeNull();
  });

  it("有 vmId:上传入口在;列表失败外显", async () => {
    const bad: CloudControl = {
      call: () => Promise.reject(new Error("环境离线")),
      revive: vi.fn(),
      close: vi.fn(),
      isClosed: () => false,
    };
    render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(bad)} />);
    expect((await screen.findByRole("alert")).textContent).toContain("环境离线");
    expect(screen.getByText("上传文件")).toBeTruthy();
  });

  // 借来的常驻控制流是宿主的保活/唤醒通道(后端每条控制连接另起一份 TaskLive
  // 上游订阅,task_control.go),本组件只借不关
  it("控制流向宿主借:卸载只 release,不 close 借来的连接", async () => {
    const { ctl } = fakeControl();
    const release = vi.fn();
    const { unmount } = render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(ctl, release)} />);
    await screen.findByText("README.md");
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
    expect(ctl.close).not.toHaveBeenCalled();
  });

  // 只能下载不能看,文件面板就只剩半个用途(旧 UI filesdrawer.tsx:428 点行即预览)
  it("点文件行:repo_read_file 取正文(base64 解码)进预览,Esc 只关预览", async () => {
    const { ctl, calls } = fakeControl();
    render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(ctl)} />);
    await userEvent.click(await screen.findByText("README.md"));
    await screen.findByText("# 项目说明");
    const read = calls.find((c) => c.kind === "repo_read_file");
    expect(read?.payload).toMatchObject({ path: "README.md", offset: 0, length: 1 << 20 });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("# 项目说明")).toBeNull();
  });

  it("超限文件不发请求,给一句人话(整包要穿两层,大文件预览既慢又没用)", async () => {
    const { ctl, calls } = fakeControl();
    const big = { ...ctl, call: ((kind: string, payload?: Record<string, unknown>) => {
      calls.push({ kind, payload });
      if (kind === "repo_file_list") return Promise.resolve({ files: [{ name: "dump.log", path: "dump.log", entry_mode: 1, size: 5 * 1024 * 1024 }] });
      return Promise.resolve({});
    }) as CloudControl["call"] };
    render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(big)} />);
    await userEvent.click(await screen.findByText("dump.log"));
    expect(await screen.findByText(/文件较大.*5\.0 MB/)).toBeTruthy();
    expect(calls.some((c) => c.kind === "repo_read_file")).toBe(false);
  });

  // LAYOUT §6.2 menu 截断铁律:daisyUI 给 .menu 和 .menu li 都上了
  // flex-flow: column wrap,漏掉 flex-nowrap 时长文件名会冲出面板
  it("列表 menu 带 flex-nowrap(含 li),长文件名才截得住", async () => {
    const { ctl } = fakeControl();
    const { container } = render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(ctl)} />);
    await screen.findByText("README.md");
    const ul = container.querySelector("ul.menu") as HTMLElement;
    expect(ul.className).toContain("flex-nowrap");
    expect(ul.className).toContain("[&_li]:flex-nowrap");
  });

  it("改动 tab:repo_file_changes 计数徽标,点条目拉 diff 预览", async () => {
    const { ctl, calls } = fakeControl();
    render(<CloudFiles taskId="t1" vmId="vm1" borrowControl={lend(ctl)} />);
    await screen.findByText("README.md");
    // 徽标计数(挂载即拉,与列目录同一条 WS)
    const tab = await screen.findByRole("tab", { name: /改动/ });
    expect(tab.textContent).toContain("1");
    await userEvent.click(tab);
    // 改动条目 = basename + 目录 + 云端超集字段 +N/-N + 状态徽标
    await screen.findByText("main.ts");
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    await userEvent.click(screen.getByText("main.ts"));
    await screen.findByText("new"); // diff 预览落地(DiffView 的 +/- 记号与行文本分列)
    expect(calls.some((c) => c.kind === "repo_file_diff" && c.payload?.path === "src/main.ts")).toBe(true);
    // 改动 tab 不显示上传入口与路径条
    expect(screen.queryByText("上传文件")).toBeNull();
  });

  it("fmtSize 可读格式", () => {
    expect(fmtSize(undefined)).toBe("");
    expect(fmtSize(512)).toBe("512 B");
    expect(fmtSize(2048)).toBe("2.0 KB");
    expect(fmtSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
