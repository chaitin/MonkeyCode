// 云端建任务的选项模型与默认值挑选,移植自 mobile/src/config.ts
// (与 Web 端 selectPreferredTaskModel / pickDefaultImage 同一套规则)。
// 纯函数无副作用;网络层在 client.ts。
import type { CloudProject } from "./types";

export interface McCloudModel {
  id?: string;
  model?: string;
  remark?: string;
  weight?: number;
  is_default?: boolean;
  is_hidden?: boolean;
  owner?: { type?: "private" | "public" | "team" };
}

export interface McCloudImage {
  id?: string;
  name?: string;
  remark?: string;
  is_default?: boolean;
  owner?: { type?: string };
}

export interface McCloudHost {
  id?: string;
  name?: string;
  remark?: string;
  external_ip?: string;
  status?: string;
  is_default?: boolean;
  owner?: { type?: string };
}

export type McCloudProject = CloudProject;

export interface McTaskOptions {
  models: McCloudModel[];
  images: McCloudImage[];
  hosts: McCloudHost[];
  projects: McCloudProject[];
  plan: string; // basic | pro | ultra | flagship | ""
  task_defaults?: { host_id?: string };
}

export const PUBLIC_CLOUD_HOST_ID = "public_host";

const BUILTIN_META = new Set(["monkeycode-basic", "monkeycode-pro", "monkeycode-ultra"]);

function builtinName(model?: string): string | undefined {
  const n = (model || "").toLowerCase();
  if (n.startsWith("monkeycode-basic")) return "monkeycode-basic";
  if (n.startsWith("monkeycode-pro")) return "monkeycode-pro";
  if (n.startsWith("monkeycode-ultra")) return "monkeycode-ultra";
  return undefined;
}

/** 内置模型名翻译为中文档位(基础/专业/旗舰模型)。 */
function translateBuiltinNames(text: string): string {
  return text
    .replace(/monkeycode-ultra/gi, "旗舰模型")
    .replace(/monkeycode-pro/gi, "专业模型")
    .replace(/monkeycode-basic/gi, "基础模型")
    .replace(/\s*\/\s*/g, " / ");
}

/** 云端模型展示名:优先 remark,再翻译内置档位。 */
export function cloudModelLabel(model?: { model?: string; remark?: string } | null): string {
  if (!model) return "";
  const remark = model.remark?.trim();
  if (remark) return translateBuiltinNames(remark);
  return translateBuiltinNames(model.model || "");
}

/** 镜像展示名与 Web 一致：优先备注，否则只展示镜像 tag 的最后一段。 */
export function cloudImageLabel(image?: McCloudImage | null): string {
  if (!image) return "";
  const remark = image.remark?.trim();
  if (remark) return remark;
  const name = image.name?.trim() || "";
  return name.slice(name.lastIndexOf("/") + 1) || "镜像";
}

/** 宿主机展示名：公共档使用稳定产品名，私有宿主优先使用备注。 */
export function cloudHostLabel(host?: McCloudHost | null): string {
  if (!host) return "";
  if (host.id === PUBLIC_CLOUD_HOST_ID) return "公共宿主机";
  if (host.remark?.trim()) return host.remark.trim();
  return [host.name, host.external_ip].filter(Boolean).join(" · ") || "宿主机";
}

/** 可选宿主机：公共宿主始终存在；离线与重复的私有宿主不进入创建列表。
 * 公共模型受云端约束，只能运行在公共宿主机。 */
export function usableCloudHosts(hosts: McCloudHost[], publicModel = false): McCloudHost[] {
  const remotePublic = hosts.find((host) => host.id === PUBLIC_CLOUD_HOST_ID);
  const publicHost: McCloudHost = {
    ...remotePublic,
    id: PUBLIC_CLOUD_HOST_ID,
    name: remotePublic?.name || "MonkeyCode",
    remark: remotePublic?.remark || "公共宿主机",
    status: "online",
    owner: remotePublic?.owner || { type: "public" },
  };
  if (publicModel) return [publicHost];

  const seen = new Set([PUBLIC_CLOUD_HOST_ID]);
  return [
    publicHost,
    ...hosts.filter((host) => {
      const id = host.id || "";
      if (!id || id.startsWith(PUBLIC_CLOUD_HOST_ID) || host.status !== "online" || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  ];
}

/** 服务端默认宿主有效时采用，否则回退公共宿主；公共模型始终强制公共宿主。 */
export function pickDefaultCloudHost(hosts: McCloudHost[], preferredId = "", publicModel = false): string {
  const available = usableCloudHosts(hosts, publicModel);
  return available.some((host) => host.id === preferredId) ? preferredId : PUBLIC_CLOUD_HOST_ID;
}

function planAllowsModel(model: McCloudModel, plan?: string): boolean {
  const b = builtinName(model.model);
  if (b === "monkeycode-pro") return plan === "pro" || plan === "flagship" || plan === "ultra";
  if (b === "monkeycode-ultra") return plan === "flagship" || plan === "ultra";
  return true;
}

const byWeightThenName = (a: McCloudModel, b: McCloudModel) => {
  const w = (b.weight || 0) - (a.weight || 0);
  return w !== 0 ? w : (a.model || "").localeCompare(b.model || "");
};

/** 可选模型:有 id、非裸内置占位项、未隐藏、会员档允许。 */
export function usableCloudModels(models: McCloudModel[], plan?: string): McCloudModel[] {
  return models
    .filter((m) => m.id && m.model && !m.is_hidden && !BUILTIN_META.has(m.model) && planAllowsModel(m, plan))
    .sort(byWeightThenName);
}

/** 默认模型:会员档匹配的内置档 weight 最高 → 公共模型 → 任意可用。 */
export function pickDefaultCloudModel(models: McCloudModel[], plan?: string): string {
  const planBuiltin = plan === "pro" ? "monkeycode-pro" : plan === "flagship" || plan === "ultra" ? "monkeycode-ultra" : "monkeycode-basic";
  const planModel = models
    .filter((m) => m.id && builtinName(m.model) === planBuiltin && planAllowsModel(m, plan))
    .sort(byWeightThenName)[0];
  if (planModel?.id) return planModel.id;
  const publicModel = models
    .filter((m) => m.id && m.owner?.type === "public" && planAllowsModel(m, plan))
    .sort(byWeightThenName)[0];
  if (publicModel?.id) return publicModel.id;
  const pool = usableCloudModels(models, plan);
  return pool.find((m) => m.is_default)?.id || pool[0]?.id || "";
}

/** 默认镜像:公共 devbox → is_default → 第一个。 */
export function pickDefaultCloudImage(images: McCloudImage[]): string {
  return (
    images.find((i) => i.owner?.type === "public" && i.remark === "devbox")?.id ||
    images.find((i) => i.is_default)?.id ||
    images[0]?.id ||
    ""
  );
}
