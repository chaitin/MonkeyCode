// 云端建任务选项纯函数:默认值挑选与档位锁定(与 Web/mobile 同一套规则)。
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { McCloudHost, McCloudModel } from "@/lib/ipc/cloudtasks";
import {
  cloudImageLabel,
  cloudModelLabel,
  isPublicModel,
  pickDefaultCloudHost,
  pickDefaultCloudImage,
  pickDefaultCloudModel,
  PUBLIC_CLOUD_HOST_ID,
  usableCloudHosts,
  usableCloudModels,
} from "./options";

// 展示名断言以中文为锚:node 环境的系统语言不可控,显式钉住
beforeEach(() => setLocale("zh-CN"));

const models: McCloudModel[] = [
  { id: "m-basic", model: "monkeycode-basic-x", owner: { type: "public" }, weight: 1 },
  { id: "m-pro", model: "monkeycode-pro-x", owner: { type: "public" }, weight: 5 },
  { id: "m-ultra", model: "monkeycode-ultra-x", owner: { type: "public" }, weight: 9 },
  { id: "m-mine", model: "my-model", owner: { type: "private" } },
  { id: "", model: "no-id" }, // 无 id:剔除
  { id: "m-meta", model: "monkeycode-pro" }, // 裸档位占位:剔除
  { id: "m-hidden", model: "hidden", is_hidden: true }, // 隐藏:剔除
];

describe("usableCloudModels / pickDefaultCloudModel", () => {
  it("剔除占位/隐藏/无 id;超档打 locked 不剔除", () => {
    const usable = usableCloudModels(models, "basic");
    expect(usable.map((m) => m.id)).toEqual(["m-ultra", "m-pro", "m-basic", "m-mine"]); // weight 降序
    expect(usable.find((m) => m.id === "m-pro")?.locked).toBe(true);
    expect(usable.find((m) => m.id === "m-ultra")?.locked).toBe(true);
    expect(usable.find((m) => m.id === "m-basic")?.locked).toBeUndefined();
  });

  it("默认模型:会员档匹配的内置档优先;locked 不参与默认", () => {
    expect(pickDefaultCloudModel(models, "pro")).toBe("m-pro");
    expect(pickDefaultCloudModel(models, "ultra")).toBe("m-ultra");
    expect(pickDefaultCloudModel(models, "")).toBe("m-basic");
  });

  it("展示名:remark 优先,内置档位翻译", () => {
    expect(cloudModelLabel({ model: "monkeycode-pro-x", remark: "" })).toContain("专业模型");
    expect(cloudModelLabel({ model: "x", remark: "自定义" })).toBe("自定义");
  });
});

describe("usableCloudHosts / pickDefaultCloudHost", () => {
  const hosts: McCloudHost[] = [
    { id: "h-online", name: "私有A", status: "online" },
    { id: "h-off", name: "私有B", status: "offline" },
    { id: PUBLIC_CLOUD_HOST_ID, name: "MonkeyCode", status: "online" },
  ];

  it("公共宿主始终第一;离线私有宿主剔除;公共模型强制公共宿主", () => {
    expect(usableCloudHosts(hosts).map((h) => h.id)).toEqual([PUBLIC_CLOUD_HOST_ID, "h-online"]);
    expect(usableCloudHosts(hosts, true).map((h) => h.id)).toEqual([PUBLIC_CLOUD_HOST_ID]);
  });

  it("默认宿主:task_defaults 有效则用,否则公共宿主", () => {
    expect(pickDefaultCloudHost(hosts, "h-online")).toBe("h-online");
    expect(pickDefaultCloudHost(hosts, "h-off")).toBe(PUBLIC_CLOUD_HOST_ID);
    expect(pickDefaultCloudHost(hosts, "h-online", true)).toBe(PUBLIC_CLOUD_HOST_ID);
  });

  it("isPublicModel:公共归属才真", () => {
    expect(isPublicModel(models, "m-pro")).toBe(true);
    expect(isPublicModel(models, "m-mine")).toBe(false);
  });
});

describe("pickDefaultCloudImage / cloudImageLabel", () => {
  it("公共 devbox → is_default → 第一个;标签取 tag 末段", () => {
    expect(
      pickDefaultCloudImage([
        { id: "i1", name: "a" },
        { id: "i2", remark: "devbox", owner: { type: "public" } },
      ]),
    ).toBe("i2");
    expect(pickDefaultCloudImage([{ id: "i1" }, { id: "i2", is_default: true }])).toBe("i2");
    expect(pickDefaultCloudImage([{ id: "i1" }])).toBe("i1");
    expect(cloudImageLabel({ name: "registry.cn/foo/devbox:1.2" })).toBe("devbox:1.2");
    expect(cloudImageLabel({ name: "x", remark: "备注优先" })).toBe("备注优先");
  });
});
