import { describe, expect, it } from "vitest";
import {
  cloudHostLabel,
  cloudImageLabel,
  cloudRepoLabel,
  groupedCloudModelLabel,
  groupCloudModels,
  pickDefaultCloudHost,
  pickDefaultCloudModel,
  PUBLIC_CLOUD_HOST_ID,
  usableCloudHosts,
  validCloudRepoUrl,
  type McCloudHost,
  type McCloudModel,
} from "./cloud";

const hosts: McCloudHost[] = [
  { id: "public_host", name: "MonkeyCode", status: "online" },
  { id: "gpu-1", remark: "GPU 工作站", external_ip: "10.0.0.8", status: "online" },
  { id: "offline-1", name: "离线主机", status: "offline" },
  { id: "gpu-1", remark: "重复主机", status: "online" },
];

const models: McCloudModel[] = [
  { id: "meta", model: "monkeycode-basic", weight: 999, owner: { type: "public" } },
  { id: "basic", model: "monkeycode-basic/claude", owner: { type: "public" } },
  { id: "pro", model: "monkeycode-pro/gpt", owner: { type: "public" } },
  { id: "ultra", model: "monkeycode-ultra/gemini", owner: { type: "public" } },
  { id: "paid", model: "openai/gpt-5", owner: { type: "public" } },
  { id: "mine", model: "local/qwen", owner: { type: "private" } },
  { id: "team", model: "team/deepseek", owner: { type: "team", id: "team-1", name: "研发团队" } },
];

describe("云端创建选项", () => {
  it("宿主机列表始终包含公共宿主，并过滤离线和重复项", () => {
    expect(usableCloudHosts(hosts).map((host) => host.id)).toEqual([PUBLIC_CLOUD_HOST_ID, "gpu-1"]);
    expect(cloudHostLabel(usableCloudHosts(hosts)[0])).toBe("公共宿主机");
    expect(cloudHostLabel(hosts[1])).toBe("GPU 工作站");
  });

  it("公共模型只能使用公共宿主机，失效默认值也会安全回退", () => {
    expect(usableCloudHosts(hosts, true).map((host) => host.id)).toEqual([PUBLIC_CLOUD_HOST_ID]);
    expect(pickDefaultCloudHost(hosts, "gpu-1", false)).toBe("gpu-1");
    expect(pickDefaultCloudHost(hosts, "gpu-1", true)).toBe(PUBLIC_CLOUD_HOST_ID);
    expect(pickDefaultCloudHost(hosts, "offline-1", false)).toBe(PUBLIC_CLOUD_HOST_ID);
  });

  it("镜像优先展示备注，否则展示镜像标签的最后一段", () => {
    expect(cloudImageLabel({ name: "registry.example.com/team/devbox:latest" })).toBe("devbox:latest");
    expect(cloudImageLabel({ name: "ignored", remark: "Ubuntu 开发环境" })).toBe("Ubuntu 开发环境");
  });

  it("按会员档位、付费、个人和团队分组模型", () => {
    const groups = groupCloudModels(models, "pro");

    expect(groups.map((group) => group.label)).toEqual([
      "基础模型",
      "专业模型",
      "旗舰模型",
      "付费模型",
      "我的模型",
      "研发团队",
    ]);
    expect(groups.find((group) => group.label === "专业模型")?.badge).toBe("专业会员免费");
    expect(groups.flatMap((group) => group.models).map((model) => model.id)).not.toContain("meta");
    expect(groupedCloudModelLabel(models[1])).toBe("claude");
    expect(pickDefaultCloudModel(models, "pro")).toBe("pro");
  });

  it("超会员档模型展示但打 locked,默认值不落在灰条目上", () => {
    const groups = groupCloudModels(models, "pro");

    const ultra = groups.find((group) => group.label === "旗舰模型")?.models ?? [];
    expect(ultra.map((model) => model.id)).toEqual(["ultra"]);
    expect(ultra[0].locked).toBe(true);
    expect(groups.find((group) => group.label === "专业模型")?.models[0].locked).toBeUndefined();

    // 订阅读取失败(plan="")时专业/旗舰全灰而非消失,默认值回落基础档
    expect(groupCloudModels(models, "").map((g) => g.label)).toContain("旗舰模型");
    expect(pickDefaultCloudModel(models, "")).toBe("basic");
    // 只剩超档模型时宁空不默认选禁用项
    expect(pickDefaultCloudModel([models[3]], "basic")).toBe("");
  });

  it("手动仓库兼容 HTTPS 和 SSH 地址，并生成简短名称", () => {
    expect(validCloudRepoUrl("https://github.com/openai/codex.git")).toBe(true);
    expect(validCloudRepoUrl("ssh://git@example.com/team/repo.git")).toBe(true);
    expect(validCloudRepoUrl("git@github.com:openai/codex.git")).toBe(true);
    expect(validCloudRepoUrl("github.com/openai/codex")).toBe(false);
    expect(cloudRepoLabel("git@github.com:openai/codex.git")).toBe("codex");
  });
});
