// 云端任务启动页:conditions → 阶段时间线的推导,以及卡片渲染的关键外显。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CloudStartupCard, startupSteps, startupTitle } from "./cloudStartup";
import type { CloudTaskDetail } from "./types";

type Cond = NonNullable<NonNullable<CloudTaskDetail["virtualmachine"]>["conditions"]>[number];

const meta = (conditions: Cond[]): CloudTaskDetail => ({ id: "t1", virtualmachine: { conditions } });

describe("startupSteps", () => {
  it("没有 conditions 时给空列表(由卡片兜底成「排队等待调度」)", () => {
    expect(startupSteps(null)).toEqual([]);
    expect(startupSteps(meta([]))).toEqual([]);
  });

  it("末项之外一律算已完成,末项按 status 判定进行中", () => {
    const steps = startupSteps(
      meta([
        { type: "Scheduled", status: 2 },
        { type: "ImagePulled", status: 1, progress: 42 },
      ]),
    );
    expect(steps).toEqual([
      { type: "Scheduled", label: "调度到宿主机", state: "done" },
      { type: "ImagePulled", label: "拉取系统镜像", state: "active", progress: 42 },
    ]);
  });

  it("同一阶段重复下发(进度刷新)按最后一次取值,顺序不跳位", () => {
    const steps = startupSteps(
      meta([
        { type: "ImagePulled", status: 1, progress: 10 },
        { type: "Scheduled", status: 2 },
        { type: "ImagePulled", status: 1, progress: 88 },
      ]),
    );
    expect(steps.map((s) => s.type)).toEqual(["ImagePulled", "Scheduled"]);
    // 末项是 Scheduled,ImagePulled 退回 done —— 但取的是最后一次的载荷
    expect(steps[0].state).toBe("done");
    expect(steps[1].state).toBe("done");
  });

  it("失败项恒为 failed,前序步骤保持已完成", () => {
    const steps = startupSteps(
      meta([
        { type: "Scheduled", status: 2 },
        { type: "Failed", status: 3, message: "宿主机资源不足" },
      ]),
    );
    expect(steps[0].state).toBe("done");
    expect(steps[1]).toEqual({ type: "Failed", label: "环境启动失败", state: "failed", message: "宿主机资源不足" });
  });

  it("末项 status=2(Ready)算已完成,不再转圈", () => {
    const steps = startupSteps(meta([{ type: "Ready", status: 2 }]));
    expect(steps[0].state).toBe("done");
  });

  it("进度只在当前项且 >0 时保留(0/缺省不画进度条)", () => {
    expect(startupSteps(meta([{ type: "ImagePulled", status: 1, progress: 0 }]))[0].progress).toBeUndefined();
    expect(startupSteps(meta([{ type: "ImagePulled", status: 1 }]))[0].progress).toBeUndefined();
  });
});

describe("startupTitle", () => {
  it("以当前步骤说明正在做什么", () => {
    expect(startupTitle(startupSteps(meta([{ type: "ProjectCloned", status: 1 }])))).toBe("正在克隆代码仓库…");
  });

  it("失败优先外显", () => {
    expect(
      startupTitle(startupSteps(meta([{ type: "Scheduled", status: 2 }, { type: "Failed", status: 3 }]))),
    ).toBe("云端开发环境启动失败");
  });

  it("无步骤时给通用文案", () => {
    expect(startupTitle([])).toBe("正在准备云端开发环境…");
  });
});

describe("CloudStartupCard", () => {
  it("展开阶段时间线,当前步骤带进度百分比", () => {
    const html = renderToStaticMarkup(
      <CloudStartupCard meta={meta([{ type: "Scheduled", status: 2 }, { type: "ImagePulled", status: 1, progress: 42 }])} />,
    );
    expect(html).toContain("调度到宿主机");
    expect(html).toContain("拉取系统镜像");
    expect(html).toContain("42%");
    // 启动期 composer 仍可用:页面要说清排队语义
    expect(html).toContain("环境就绪后自动送达");
  });

  it("已排队时改说排队文案", () => {
    const html = renderToStaticMarkup(<CloudStartupCard meta={meta([{ type: "Scheduled", status: 1 }])} queued />);
    expect(html).toContain("已排队的内容会在环境就绪后自动送达");
  });

  it("失败态外显原因与补救路径,不再提排队", () => {
    const html = renderToStaticMarkup(
      <CloudStartupCard meta={meta([{ type: "Failed", status: 3, message: "镜像拉取超时" }])} />,
    );
    expect(html).toContain("云端开发环境启动失败");
    expect(html).toContain("镜像拉取超时");
    expect(html).toContain("终止任务后重新创建");
    expect(html).not.toContain("自动送达");
  });

  it("尚无 conditions 时兜底一行「排队等待调度」", () => {
    const html = renderToStaticMarkup(<CloudStartupCard meta={null} />);
    expect(html).toContain("排队等待调度");
  });
});
