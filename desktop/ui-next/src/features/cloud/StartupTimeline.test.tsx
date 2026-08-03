// 启动时间线:conditions → 步骤推导(纯函数)+ 渲染冒烟。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CloudTaskDetail } from "@/lib/ipc/cloudtasks";
import { StartupTimeline, startupSteps } from "./StartupTimeline";

const meta = (conditions: NonNullable<CloudTaskDetail["virtualmachine"]>["conditions"]): CloudTaskDetail => ({
  id: "t1",
  virtualmachine: { id: "vm1", status: "creating", conditions },
});

describe("startupSteps", () => {
  it("按 type 去重保留最后一次;非末项即完成;末项按 status 判定", () => {
    const steps = startupSteps(
      meta([
        { type: "Scheduled", status: 2 },
        { type: "ImagePulled", status: 1, progress: 10 },
        { type: "ImagePulled", status: 1, progress: 42 }, // 同阶段进度刷新:不跳位
        { type: "ProjectCloned", status: 1 },
      ]),
    );
    expect(steps.map((s) => [s.type, s.state])).toEqual([
      ["Scheduled", "done"],
      ["ImagePulled", "done"], // 非末项:进入下一阶段即视为完成
      ["ProjectCloned", "active"],
    ]);
  });

  it("失败项带原因;进度只挂在 active 项上", () => {
    const steps = startupSteps(
      meta([
        { type: "Scheduled", status: 2 },
        { type: "ImagePulled", status: 3, message: "镜像仓库不可达" },
      ]),
    );
    expect(steps[1]).toMatchObject({ type: "ImagePulled", state: "failed", message: "镜像仓库不可达" });
    const active = startupSteps(meta([{ type: "ImagePulled", status: 1, progress: 42 }]));
    expect(active[0]).toMatchObject({ state: "active", progress: 42 });
  });

  it("空 conditions → 空步骤(视图渲染排队占位)", () => {
    expect(startupSteps(null)).toEqual([]);
  });
});

describe("StartupTimeline 渲染", () => {
  it("当前步骤进标题;进度百分比外显", () => {
    render(
      <StartupTimeline
        meta={meta([
          { type: "Scheduled", status: 2 },
          { type: "ImagePulled", status: 1, progress: 42 },
        ])}
      />,
    );
    expect(screen.getByText("正在拉取系统镜像…")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("调度到宿主机")).toBeTruthy();
  });

  it("失败:红标题 + 原因 + 重建提示", () => {
    render(
      <StartupTimeline
        meta={meta([{ type: "ImagePulled", status: 3, message: "镜像仓库不可达" }])}
      />,
    );
    expect(screen.getByText("云端开发环境启动失败")).toBeTruthy();
    expect(screen.getByText("镜像仓库不可达")).toBeTruthy();
    expect(screen.getByText("可终止任务后重新创建。")).toBeTruthy();
  });

  it("还没有 conditions:排队占位", () => {
    render(<StartupTimeline meta={null} />);
    expect(screen.getByText("正在准备云端开发环境…")).toBeTruthy();
    expect(screen.getByText("排队等待调度")).toBeTruthy();
  });
});
