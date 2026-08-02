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
  owner?: { type?: "private" | "public" | "team"; id?: string; name?: string };
  /** 超会员档:展示但禁选(升级解锁);usableCloudModels 派生,非服务端字段 */
  locked?: boolean;
}

export interface McCloudModelGroup {
  key: string;
  label: string;
  badge?: string;
  models: McCloudModel[];
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

/** 底层模型串 → 会员档位短词(基础/专业/旗舰),判不出返回 undefined。
 * 与 Web getBuiltinModelName 同款前缀口径;本地/云端选择器的档位药丸共用。 */
export function builtinTierLabel(model?: string): string | undefined {
  switch (builtinName(model)) {
    case "monkeycode-basic":
      return "基础";
    case "monkeycode-pro":
      return "专业";
    case "monkeycode-ultra":
      return "旗舰";
    default:
      return undefined;
  }
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

/** 分组内不重复展示「基础模型 /」等前缀。 */
export function groupedCloudModelLabel(model: McCloudModel): string {
  const label = cloudModelLabel(model);
  const nested = label.replace(/^(基础|专业|旗舰)模型\s*\/\s*/i, "").trim();
  return nested || label;
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

/** 手动仓库地址规则与移动端一致，兼容 HTTPS 与常见 SSH Git 地址。 */
export function validCloudRepoUrl(value: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@)\S+$/i.test(value.trim());
}

export function cloudRepoLabel(value: string): string {
  const path = value
    .trim()
    .replace(/^git@[^:]+:/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const tail = path.split("/").pop()?.replace(/\.git$/i, "");
  return tail || "仓库";
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

/** 可选模型:有 id、非裸内置占位项、未隐藏。超会员档不再剔除,打 locked
 * 灰态展示(对齐本地选择器与 Web 端 canUseModelBySubscription 的做法)。 */
export function usableCloudModels(models: McCloudModel[], plan?: string): McCloudModel[] {
  return models
    .filter((m) => m.id && m.model && !m.is_hidden && !BUILTIN_META.has(m.model.toLowerCase()))
    .map((m) => (planAllowsModel(m, plan) ? m : { ...m, locked: true }))
    .sort(byWeightThenName);
}

/** 模型分级与 Web / 移动端一致：会员档位、付费、我的、团队。 */
export function groupCloudModels(models: McCloudModel[], plan?: string): McCloudModelGroup[] {
  const supported = usableCloudModels(models, plan);
  const builtin: McCloudModelGroup[] = [
    { key: "monkeycode-basic", label: "基础模型", badge: "免费使用", models: [] },
    { key: "monkeycode-pro", label: "专业模型", badge: "专业会员免费", models: [] },
    { key: "monkeycode-ultra", label: "旗舰模型", badge: "旗舰会员免费", models: [] },
  ].map((group) => ({
    ...group,
    models: supported.filter((model) => builtinName(model.model) === group.key),
  }));

  const paid = supported.filter((model) => model.owner?.type === "public" && !builtinName(model.model));
  const personal = supported.filter((model) => model.owner?.type === "private" && !builtinName(model.model));
  const teams = new Map<string, McCloudModelGroup>();
  for (const model of supported.filter((item) => item.owner?.type === "team" && !builtinName(item.model))) {
    const name = model.owner?.name || "团队模型";
    const key = `${model.owner?.id || name}:${name}`;
    const group = teams.get(key) || { key, label: name, models: [] };
    group.models.push(model);
    teams.set(key, group);
  }

  return [
    ...builtin,
    { key: "paid", label: "付费模型", badge: "消耗积分", models: paid },
    { key: "private", label: "我的模型", models: personal },
    ...teams.values(),
  ].filter((group) => group.models.length > 0);
}

/** 默认模型:会员档匹配的内置档 weight 最高 → 公共模型 → 任意可用。
 * locked 条目只展示不参与默认值(宁空不默认选禁用项)。 */
export function pickDefaultCloudModel(models: McCloudModel[], plan?: string): string {
  const pool = usableCloudModels(models, plan).filter((m) => !m.locked);
  const planBuiltin = plan === "pro" ? "monkeycode-pro" : plan === "flagship" || plan === "ultra" ? "monkeycode-ultra" : "monkeycode-basic";
  const planModel = pool
    .filter((m) => builtinName(m.model) === planBuiltin)
    .sort(byWeightThenName)[0];
  if (planModel?.id) return planModel.id;
  const publicModel = pool
    .filter((m) => m.owner?.type === "public")
    .sort(byWeightThenName)[0];
  if (publicModel?.id) return publicModel.id;
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
