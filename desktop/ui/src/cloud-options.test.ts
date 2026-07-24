import { describe, expect, it } from "vitest";
import {
  cloudHostLabel,
  cloudImageLabel,
  pickDefaultCloudHost,
  PUBLIC_CLOUD_HOST_ID,
  usableCloudHosts,
  type McCloudHost,
} from "./cloud";

const hosts: McCloudHost[] = [
  { id: "public_host", name: "MonkeyCode", status: "online" },
  { id: "gpu-1", remark: "GPU 工作站", external_ip: "10.0.0.8", status: "online" },
  { id: "offline-1", name: "离线主机", status: "offline" },
  { id: "gpu-1", remark: "重复主机", status: "online" },
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
});
