// 设置页的纯配置映射:表单草稿 ⇄ 内核 config.json / mcp.json 形态。
// 与渲染无关(不引入 React),从 settings.tsx 拆出来:视图只管交互,
// 往返语义(字段白名单、extra 透传、整组替换、名称校验)集中在此并被单测直接盯住。
import { modelSourceRank } from "./modelMenu";
import type { HostConfig, HostModel } from "./types";

// ---- MCP 编辑模型与序列化(与内核 mcp.json 的 mcpServers 同构,壳不解释) ----

export interface McpEntry {
  name: string;
  type: "http" | "stdio";
  url: string;
  command: string;
  args: string; // 空格分隔
  kv: string; // 每行 KEY=VALUE;http→headers,stdio→env
  source?: string; // "baizhi"=百智云同步;缺省=手工。随 mcp.json 落盘(内核忽略)
  /** 表单未呈现的其余字段(如 disabled):原样携带,保存时透传回 mcp.json 不丢失 */
  extra?: Record<string, unknown>;
}

const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** MCP server 名会进入 mcp__<server>__<tool>，因此必须满足模型工具名约束。 */
export function mcpNameValidationError(name: string): string | null {
  const normalized = name.trim();
  if (!normalized) return "请输入 MCP 名称";
  if (!MCP_NAME_PATTERN.test(normalized)) return "仅支持英文字母、数字、_ 和 -";
  return null;
}

/** 返回与 entries 同下标的错误；trim 后重名的两项都会被标记。 */
export function validateMcpNames(entries: ReadonlyArray<{ name: string }>): Array<string | null> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const name = entry.name.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return entries.map((entry) => {
    const name = entry.name.trim();
    const formatError = mcpNameValidationError(entry.name);
    if (formatError) return formatError;
    return (counts.get(name) ?? 0) > 1 ? `MCP 名称重复: ${name}` : null;
  });
}

/** serversToMcps 拆进表单字段的键;其余键进 extra 原样往返 */
const MCP_FORM_KEYS = new Set(["url", "command", "args", "env", "headers", "source"]);

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

export function mcpsToServers(mcps: McpEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of mcps) {
    const name = m.name.trim();
    if (!name) continue;
    // extra 先铺底(disabled 等表单外字段透传),表单字段覆盖;
    // source 随条目落盘(内核 mcp.json 解析忽略;omitempty 语义,手工条目不带)
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
      type: stdio ? "stdio" : "http",
      url: typeof cfg.url === "string" ? cfg.url : "",
      command: typeof cfg.command === "string" ? cfg.command : "",
      args: Array.isArray(cfg.args) ? cfg.args.map(String).join(" ") : "",
      kv: stringifyKV(stdio ? cfg.env : cfg.headers),
      source: typeof cfg.source === "string" ? cfg.source : undefined,
      extra: Object.keys(extra).length ? extra : undefined,
    };
  });
}

export const emptyModel = (): HostModel => ({
  name: "",
  provider: "anthropic",
  base_url: "",
  api_key: "",
  model: "",
});

/** 设置页模型草稿 → 受支持的持久化 schema；未知/旧实验字段不透传。 */
export function modelsToConfig(models: HostModel[], defaultIdx: number): HostModel[] {
  return models.map((m, i) => ({
    name: m.name.trim(),
    provider: m.provider,
    base_url: m.base_url,
    api_key: m.api_key,
    model: m.model,
    default: i === defaultIdx,
    context_window: m.context_window,
    max_output: m.max_output,
    think: m.think,
    vision: m.vision,
    source: m.source,
    // 会员同步的锁定/归属标记:白名单漏掉它们的话,任意一次保存都会把
    // 字段剥掉——锁定条目静默变可选、物化时被注入凭据
    locked: m.locked,
    owner: m.owner,
  }));
}
export const emptyMcp = (): McpEntry => ({ name: "", type: "http", url: "", command: "", args: "", kv: "" });

/** 同步来源组整组替换(模型与 MCP、百智云与 MonkeyCode 共用语义):
 * 非本组条目(手工条目与其他 source 组)原样保留,本组(source 匹配)替换为
 * 本次同步集合——下架的旧同步条目随之移除(重同步清理)。
 * 跨组撞名一律先到先得:名称是引擎寻址键(会话/记忆按名引用),不同来源的
 * 同名条目是不同通道甚至不同计费主体,同步是登录后自动发生的,绝不静默
 * 换通道;后来者跳过,由调用方外显跳过名单(想换通道:删除原条目再重同步)。
 * 先到先得也保证名字跨多次同步稳定,不随对面通道上下架漂移。 */
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

/** 载入自愈:同名(trim)条目收敛为一条——内容后者覆盖前者、落在首现位置,
 * 与引擎物化(settings.models 以名字为键的 Map)实际生效行为完全一致。
 * 历史版本/手工编辑落盘的同名存量若不在载入时收敛,保存会被重名校验
 * 永久拦死,而被拦的那条在引擎侧本来就是静默失效的。空名草稿不参与。 */
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

/** 展示/落盘的分组排序:组间按来源优先级(会员 → 百智云 → 未知 → 自定义,
 * 与选择器 tab 序同源 modelSourceRank),组内保持原相对顺序(稳定排序)。
 * 设置页载入与同步替换后都过一遍,列表顺序与选择器 tab 序一致、可预期;
 * 空名草稿 source 缺省归自定义组,随手工条目留在尾部。 */
export function sortModelsBySource<T extends { source?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => modelSourceRank(a.source) - modelSourceRank(b.source));
}

// 归一化保存载荷:save() 与 dirty 比较共用同一形态(名称 trim、default 重算、MCP 序列化)
export const payloadOf = (ms: HostModel[], di: number, mc: McpEntry[], ke: string, mcUrl: string, mcBasic: string, mcLlm: string): HostConfig => ({
  // 显式列出内核支持的字段，避免旧版/实验 UI 字段只写进 config.json、
  // 物化时被静默丢弃，形成“保存成功但完全不生效”的幽灵配置。
  models: modelsToConfig(ms, di),
  mcp_servers: mcpsToServers(mc),
  kernel_env: ke,
  mc_base_url: mcUrl.trim(),
  mc_basic_auth: mcBasic.trim(),
  mc_llm_base_url: mcLlm.trim(),
});
