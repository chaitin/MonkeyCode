// 设置表单的纯逻辑:草稿 ⇄ save_config 全量载荷、脏判定、校验。
// 与渲染无关(不引入 React),往返语义集中在此被单测直接盯住:
// - 模型字段白名单:未知/旧实验字段不透传,避免只写 config.json、物化时被
//   静默丢弃的"幽灵配置";白名单漏掉 locked/owner 会让锁定条目一次保存后
//   静默变可选,必须全列。
// - MCP 表单 ⇄ mcpServers(与内核 mcp.json 同构):表单未呈现的字段
//   (disabled 等)进 extra 原样往返,不因一次保存丢失。
// - 表单外的顶层字段(mc_* / 壳自有偏好)从载入的配置原样透传(全量写回)。
// - 同步并入(百智云/会员模型 → 草稿):整组替换 + 跨组撞名先到先得,
//   移植旧工程 settingsConfig 同名函数,语义注释随迁。
import type { BaizhiSyncedModel } from "@/lib/ipc/account";
import type { DesktopConfig, HostModel } from "@/lib/ipc/config";
import { memberTierRank, modelSourceRank, sameModelName, stripSourceSuffix, SOURCE_BAIZHI, SOURCE_MONKEYCODE } from "@/lib/models/modelMenu";

// ---- MCP 编辑模型与序列化 ----

export interface McpEntry {
  name: string;
  type: "http" | "stdio";
  url: string;
  command: string;
  args: string; // 空格分隔
  kv: string; // 每行 KEY=VALUE;http→headers,stdio→env
  /** 条目来源("baizhi" 同步等);随 mcp.json 落盘,内核忽略 */
  source?: string;
  /** 表单未呈现的其余字段:原样携带,保存时透传回 mcp.json 不丢失 */
  extra?: Record<string, unknown>;
}

/** serversToMcps 拆进表单字段的键;其余键进 extra 原样往返 */
const MCP_FORM_KEYS = new Set(["url", "command", "args", "env", "headers", "source"]);

/** MCP server 名会进入 mcp__<server>__<tool>,须满足模型工具名约束。 */
export const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function parseKV(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let n = 0;
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (!k) continue;
    out[k] = line.slice(i + 1).trim();
    n++;
  }
  return n ? out : undefined;
}

const stringifyKV = (obj: unknown): string =>
  obj && typeof obj === "object"
    ? Object.entries(obj as Record<string, unknown>)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("\n")
    : "";

/** 表单 → mcpServers:空名/缺 URL/缺命令的条目跳过(校验会先拦住有名字的)。 */
export function mcpsToServers(mcps: McpEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of mcps) {
    const name = m.name.trim();
    if (!name) continue;
    // extra 先铺底(disabled 等表单外字段透传),表单字段覆盖;
    // source 随条目落盘(omitempty 语义,手工条目不带)
    const src = m.source ? { source: m.source } : {};
    if (m.type === "stdio") {
      if (!m.command.trim()) continue;
      const args = m.args.trim() ? m.args.trim().split(/\s+/) : undefined;
      out[name] = { ...m.extra, command: m.command.trim(), args, env: parseKV(m.kv), ...src };
    } else {
      if (!m.url.trim()) continue;
      out[name] = { ...m.extra, url: m.url.trim(), headers: parseKV(m.kv), ...src };
    }
  }
  return out;
}

export function serversToMcps(servers: Record<string, unknown>): McpEntry[] {
  return Object.entries(servers).map(([name, c]) => {
    const cfg = (c ?? {}) as Record<string, unknown>;
    const stdio = typeof cfg.command === "string" && cfg.command !== "";
    const extra = Object.fromEntries(Object.entries(cfg).filter(([k]) => !MCP_FORM_KEYS.has(k)));
    return {
      name,
      type: stdio ? ("stdio" as const) : ("http" as const),
      url: typeof cfg.url === "string" ? cfg.url : "",
      command: typeof cfg.command === "string" ? cfg.command : "",
      args: Array.isArray(cfg.args) ? cfg.args.map(String).join(" ") : "",
      kv: stringifyKV(stdio ? cfg.env : cfg.headers),
      source: typeof cfg.source === "string" ? cfg.source : undefined,
      extra: Object.keys(extra).length ? extra : undefined,
    };
  });
}

// ---- 草稿 ----

export interface SettingsDraft {
  models: HostModel[];
  /** 默认模型的行下标(载荷里重算 default 标记) */
  defaultIdx: number;
  mcps: McpEntry[];
  /** "" = 本机;"wsl:<发行版>" */
  kernelEnv: string;
  /** 自建/私有化部署(账号分区的高级块;"" = 官方云)。壳在启动时构造云端
   *  服务,故这三项保存后要**重启应用**才生效——文案在设置页说明 */
  mcBaseUrl: string;
  /** 测试环境反代的 HTTP Basic Auth("user:pass") */
  mcBasicAuth: string;
  /** 模型请求地址(llmproxy);"" = 官方云走 proxy 子域、自建走 {服务地址}/v1
   *  (口径在壳侧 baizhi::resolve_mc_llm) */
  mcLlmBaseUrl: string;
}

export const emptyModel = (): HostModel => ({
  name: "",
  provider: "anthropic",
  base_url: "",
  api_key: "",
  model: "",
});

export const emptyMcp = (): McpEntry => ({ name: "", type: "http", url: "", command: "", args: "", kv: "" });

/** 载入自愈:同名(trim)条目收敛为一条——内容后者覆盖前者、落在首现位置,
 * 与引擎物化(settings.models 以名字为键的 Map)实际生效行为完全一致。
 * 历史版本/手工编辑落盘的同名存量若不在载入时收敛,保存会被重名校验
 * (validateDraft → modelDup)**永久拦死**:save() 在校验处直接 return,于是
 * kernel_env、MCP、新加的模型……什么都存不下去;而被拦的那条在引擎侧本来
 * 就是静默失效的。同名条目若是 source=monkeycode 的会员行,UI 里连删除入口
 * 都没有(ModelsSection 只给手工条目 删除),用户无路可走。空名草稿不参与。
 * (移植旧工程 settingsConfig.dedupeModelsByName,ui-next 首版漏迁) */
export function dedupeModelsByName<T extends { name: string }>(list: T[]): T[] {
  const winner = new Map<string, T>();
  for (const m of list) {
    const n = m.name.trim();
    if (n) winner.set(n, m);
  }
  const emitted = new Set<string>();
  const out: T[] = [];
  for (const m of list) {
    const n = m.name.trim();
    if (!n) {
      out.push(m);
      continue;
    }
    if (emitted.has(n)) continue;
    emitted.add(n);
    out.push(winner.get(n)!);
  }
  return out;
}

export function draftFromConfig(cfg: DesktopConfig): SettingsDraft {
  // 先收敛同名再定位默认位:去重后下标会变,顺序必须是"归一 → findIndex"
  const models = dedupeModelsByName((cfg.models ?? []).map((m) => ({ ...m })));
  const di = models.findIndex((m) => m.default);
  return {
    models,
    defaultIdx: di >= 0 ? di : 0,
    mcps: serversToMcps(cfg.mcp_servers ?? {}),
    kernelEnv: cfg.kernel_env ?? "",
    mcBaseUrl: cfg.mc_base_url ?? "",
    mcBasicAuth: cfg.mc_basic_auth ?? "",
    mcLlmBaseUrl: cfg.mc_llm_base_url ?? "",
  };
}

/** 全空的模型草稿行:不进载荷、不参与校验(加了行没填 = 没加)。 */
const isBlankModel = (m: HostModel): boolean =>
  !m.name.trim() && !m.base_url.trim() && !m.api_key && !m.model.trim();

const isBlankMcp = (e: McpEntry): boolean =>
  !e.name.trim() && !e.url.trim() && !e.command.trim() && !e.args.trim() && !e.kv.trim();

/** 草稿 → save_config 全量载荷:表单外的顶层字段(壳自有偏好)从 base
 *  原样透传;模型按白名单收敛并重算 default;MCP 序列化回 mcpServers;
 *  自建部署三项由草稿写回(trim 后落盘,空串 = 官方云)。 */
export function buildPayload(base: DesktopConfig, draft: SettingsDraft): DesktopConfig {
  const models = draft.models
    .map((m, i) => ({ m, isDefault: i === draft.defaultIdx }))
    .filter(({ m }) => !isBlankModel(m))
    .map(({ m, isDefault }) => ({
      name: m.name.trim(),
      provider: m.provider,
      base_url: m.base_url,
      api_key: m.api_key,
      model: m.model,
      default: isDefault,
      context_window: m.context_window,
      max_output: m.max_output,
      think: m.think,
      vision: m.vision,
      source: m.source,
      locked: m.locked,
      owner: m.owner,
    }));
  return {
    ...base,
    models,
    mcp_servers: mcpsToServers(draft.mcps),
    kernel_env: draft.kernelEnv,
    mc_base_url: draft.mcBaseUrl.trim(),
    mc_basic_auth: draft.mcBasicAuth.trim(),
    mc_llm_base_url: draft.mcLlmBaseUrl.trim(),
  };
}

/** 脏判定:两份载荷都出自 buildPayload(同一 base、同样的键序),
 *  JSON 串比较即语义比较;undefined 字段序列化时自然脱落,两侧一致。 */
export function payloadEquals(a: DesktopConfig, b: DesktopConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- 同步并入(百智云/会员模型 → 草稿) ----

const SOURCE_SUFFIX: Record<string, string> = {
  [SOURCE_BAIZHI]: `@${SOURCE_BAIZHI}`,
  [SOURCE_MONKEYCODE]: `@${SOURCE_MONKEYCODE}`,
};

/** 同步条目的落盘名 = 短名 + 来源后缀(展示层剥掉;重同步不叠加)。
 * 会员条目再缀服务端配置 id:名字取自 remark(后台人起的备注),同一批里
 * 重名很正常,只靠来源后缀两条还是同名 → 仍会丢掉一条。id 由条目自身决定,
 * 不受同批其他条目影响,所以名字既唯一又不会因别的条目增删而改变。
 * 百智云条目的 name 本就是模型 id(壳侧 sync),组内天然唯一,不必再缀。 */
export function syncedName(name: string, source?: string, id?: string): string {
  const base = stripSourceSuffix(name.trim()).trim();
  const suffix = source ? SOURCE_SUFFIX[source] : undefined;
  if (!base || !suffix) return base;
  const entryId = source === SOURCE_MONKEYCODE ? (id?.trim() ?? "") : "";
  return entryId ? `${base}${suffix}#${entryId}` : `${base}${suffix}`;
}

/** 同步来源组整组替换(模型与 MCP 共用语义):非本组条目原样保留,本组替换
 * 为本次同步集合——下架的旧同步条目随之移除(重同步清理)。
 * 跨组撞名一律先到先得:名称是引擎寻址键(会话/记忆按名引用),不同来源的
 * 同名条目是不同通道甚至不同计费主体,同步是登录后自动发生的,绝不静默
 * 换通道;后来者跳过,由调用方外显跳过名单(想换通道:删除原条目再重同步)。 */
export function replaceSourceGroup<T extends { name: string; source?: string }>(
  cur: T[],
  synced: T[],
  source: string,
): T[] {
  const kept = cur.filter((m) => m.name.trim() && m.source !== source);
  const byName = new Map(kept.map((m) => [m.name.trim(), m]));
  const keptNames = new Set(byName.keys());
  for (const e of synced) {
    const name = e.name.trim();
    if (keptNames.has(name)) continue;
    byName.set(name, e);
  }
  return [...byName.values()];
}

/** 展示/落盘的分组排序:组间按来源优先级(modelSourceRank 单一出处),
 * 组内保持原相对顺序(稳定排序)。 */
export function sortModelsBySource<T extends { source?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => modelSourceRank(a.source) - modelSourceRank(b.source));
}

export interface SyncMergeResult {
  draft: SettingsDraft;
  /** 跨组撞名被跳过的条目(展示名,带 @source 的落盘名是实现细节) */
  skipped: string[];
}

/** 自动挑默认时的优先级:会员条目优先(会员模型是账号权益的主路径),
 * 会员组内按档位 ultra > pro > basic > 无档。同分保首现(列表已按来源
 * 排过序,会员组在最前)。 */
const autoDefaultRank = (m: HostModel): number =>
  (m.source === SOURCE_MONKEYCODE ? 10 : 0) + memberTierRank(m.model);

/** 同步模型并入草稿:整组替换 + 按来源重排;默认模型按名字重新定位——
 * 被移除回退首个未锁条目,降档重同步后原默认可能变锁定同样让位(锁定条目
 * 不物化,default 落它头上等于没有默认)。空集合不视为"清空该组"。 */
export function mergeSyncedModels(
  draft: SettingsDraft,
  syncedModels: BaizhiSyncedModel[],
  source: string,
): SyncMergeResult | null {
  if (!syncedModels.length) return null;
  const defaultName = draft.models[draft.defaultIdx]?.name?.trim() ?? "";
  const synced: HostModel[] = syncedModels.map((sm) => ({
    name: syncedName(sm.name, source, sm.id),
    provider: sm.provider,
    base_url: sm.base_url,
    api_key: sm.api_key,
    model: sm.model,
    context_window: sm.context_window,
    max_output: sm.max_output,
    think: sm.think,
    vision: sm.vision,
    source: sm.source,
    locked: sm.locked,
    owner: sm.owner,
  }));
  const outside = new Set(draft.models.filter((m) => m.source !== source && m.name.trim()).map((m) => m.name.trim()));
  const skipped = synced.filter((m) => outside.has(m.name.trim())).map((m) => stripSourceSuffix(m.name.trim()));
  const next = sortModelsBySource(replaceSourceGroup(draft.models, synced, source));
  // 精确没中再按宽松口径找一次:加后缀前落盘的默认项记的是裸名,不这么兜
  // 一次,升级后第一次同步会把默认模型悄悄挪到列表第一条
  let di = next.findIndex((m) => m.name.trim() === defaultName);
  if (di < 0) di = next.findIndex((m) => sameModelName(m.name, defaultName));
  const cur = di >= 0 ? next[di] : undefined;
  // 会员组同步时把默认接管过来:扫码登录会先后跑百智云与会员两路同步,
  // 百智云先落地按上面的规则挑走了默认,会员模型随后进来也抢不回,结果
  // 就是「有会员却默认用百智云」(2026-08-06 用户报障)。判据只认**同步来的**
  // 非会员默认(source 非空);手工条目当默认时不抢——那是用户自己配的,
  // 明确选择,不该被一次登录同步改掉
  const memberClaims = source === SOURCE_MONKEYCODE && !!cur?.source && cur.source !== SOURCE_MONKEYCODE;
  if (!cur || cur.locked || memberClaims) {
    // 无默认(首次登录同步)/原默认已锁定/让位给会员条目:回落到未锁条目
    // 里优先级最高的第一条(会员优先,组内 ultra > pro > basic > 无档;
    // 严格大于保首现,全平即首个未锁条目 = 原行为)。2026-08-06 用户定案
    di = -1;
    for (let i = 0; i < next.length; i++) {
      const m = next[i]!;
      if (m.locked) continue;
      if (di < 0 || autoDefaultRank(m) > autoDefaultRank(next[di]!)) di = i;
    }
  }
  di = di >= 0 ? di : 0;
  return { draft: { ...draft, models: next, defaultIdx: di }, skipped };
}

/** 断开某个同步来源:整组移除 + 默认位重定位。返回 null = 本来就没有该组的
 * 条目(调用方据此不惊动保存)。
 *
 * 旧 UI settings.tsx::disconnectMcWithCleanup 的第四步(ui-next 漏迁)。
 * 不清理的后果不是"列表里多几行没用的":①会员行在 ModelsSection 里**没有
 * 删除按钮**(只给 !source 的手工条目),用户在应用内无路可走;②壳侧也不
 * 代劳——baizhi/mod.rs 的 revoke 只删网关 key 与本机 Key 文件,config.rs
 * 下次物化照样把会员条目写进引擎、api_key 落成空串;③最要命的是
 * autoDefaultRank 给会员条目 +10,「首装→连接→同步」这条主流程走完,落盘的
 * default 基本必然在会员条目上——断开之后新建对话什么都不改、直接发消息
 * 就鉴权失败,而报错里看不出跟刚才那次断开有关。 */
export function removeSyncedSource(draft: SettingsDraft, source: string): SettingsDraft | null {
  const defaultName = draft.models[draft.defaultIdx]?.name?.trim() ?? "";
  const next = draft.models.filter((m) => m.source !== source);
  if (next.length === draft.models.length) return null;
  let di = next.findIndex((m) => m.name.trim() === defaultName);
  if (di < 0) {
    // 默认项正是被移除的那组:回落到未锁条目里优先级最高的第一条
    // (与 mergeSyncedModels 的回落口径同一份规则)
    for (let i = 0; i < next.length; i++) {
      const m = next[i]!;
      if (m.locked) continue;
      if (di < 0 || autoDefaultRank(m) > autoDefaultRank(next[di]!)) di = i;
    }
  }
  return { ...draft, models: next, defaultIdx: di >= 0 ? di : 0 };
}

/** 同步 MCP 并入草稿(百智云):整组替换,空集不清组(如网关未开通则不触碰;
 * 对齐模型语义)。同步条目已带 source=baizhi。 */
export function mergeSyncedMcps(draft: SettingsDraft, servers: Record<string, unknown>): SettingsDraft {
  const synced = serversToMcps(servers);
  if (!synced.length) return draft;
  return { ...draft, mcps: replaceSourceGroup(draft.mcps, synced, SOURCE_BAIZHI) };
}

// ---- 保存前校验(首个错误即返回,保存条外显) ----

export type DraftError =
  | { kind: "modelName" }
  | { kind: "modelDup"; name: string }
  | { kind: "modelIncomplete"; name: string }
  | { kind: "mcpName"; name: string }
  | { kind: "mcpDup"; name: string }
  | { kind: "mcpIncomplete"; name: string };

// 不校验 max_output 与 context_window 的比例(用户定案 2026-08-06):旧 UI 曾
// 拦 max_output ≥ 窗口 10%(引擎在占用 90% 才压缩且不预留输出空间,高占用的
// 请求会被服务端以"输入+输出超上限"拒)。但产品默认自己就越界(200k 窗口配
// 32768 输出 = 16.4%,留空不报错、显式填同一个值反而报错),主流模型的真实
// 输出上限(128k+32k、200k+64k)也普遍越界,而拦的是整次保存、会员条目在设
// 置页又改不到——偶发失败换来的是配置面被拦死。越界与否交服务端在请求时报。
export function validateDraft(draft: SettingsDraft): DraftError | null {
  const modelNames = new Set<string>();
  for (const m of draft.models) {
    if (isBlankModel(m)) continue;
    const n = m.name.trim();
    if (!n) return { kind: "modelName" };
    if (modelNames.has(n)) return { kind: "modelDup", name: n };
    modelNames.add(n);
    // 完整性(旧 UI settings.tsx::validateBeforeSave 第一段,ui-next 漏迁)。
    // isBlankModel 要求四项**全空**才当没加,所以任何半成品都会落盘,而下游
    // 一道关都没有:输入框无 required、壳侧 config.rs 直接写盘。表现是"界面
    // 说保存成功、保存条收起、引擎还白重启一次,全程无报错",之后这条模型
    // 出现在 composer 选择器里,选中发消息必然失败(缺 model → 物化时静默
    // 丢弃但选择器读的是 config.json 原文所以条目还在;缺 api_key → 服务端
    // 拒)。设置页自己的空态文案写的就是「需要名称、接口地址、API Key 与
    // 模型标识」。同步条目豁免:会员/百智云的 api_key 由壳在物化时补,
    // 且这些行在设置页根本改不到,拦它等于把配置面锁死。
    if (!m.source && (!m.base_url.trim() || !m.api_key.trim() || !m.model.trim())) {
      return { kind: "modelIncomplete", name: n };
    }
  }
  const mcpNames = new Set<string>();
  for (const e of draft.mcps) {
    if (isBlankMcp(e)) continue;
    const n = e.name.trim();
    if (!MCP_NAME_PATTERN.test(n)) return { kind: "mcpName", name: n };
    if (mcpNames.has(n)) return { kind: "mcpDup", name: n };
    mcpNames.add(n);
    // 有名字但序列化会被跳过的条目要拦下来,否则"保存成功"却静默丢条目
    if (e.type === "http" ? !e.url.trim() : !e.command.trim()) {
      return { kind: "mcpIncomplete", name: n };
    }
  }
  return null;
}
