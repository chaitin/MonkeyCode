// 设置页的纯配置映射:表单草稿 ⇄ 内核 config.json / mcp.json 形态。
// 与渲染无关(不引入 React),从 settings.tsx 拆出来:视图只管交互,
// 往返语义(字段白名单、extra 透传、整组替换、名称校验)集中在此并被单测直接盯住。
import { SOURCE_BAIZHI, type HostConfig, type HostModel } from "./types";

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
    vision: m.vision,
    source: m.source,
  }));
}
export const emptyMcp = (): McpEntry => ({ name: "", type: "http", url: "", command: "", args: "", kv: "" });

/** 百智云组整组替换(模型与 MCP 共用语义):手工条目(无 source)原样保留,
 * 百智云组替换为本次同步集合——取消勾选的旧同步条目随之移除(重同步清理)。
 * keepManualOnCollision:同名手工条目是否保留——MCP 导入是全有全无的单个勾选,
 * 用户无法逐条排除,不能静默吞掉手工配置(一旦被覆盖归组,下次重同步会连带删除);
 * 模型导入经逐条勾选确认,同名手工条目按用户选择被同步值覆盖并归组。 */
export function replaceBaizhiGroup<T extends { name: string; source?: string }>(
  cur: T[],
  synced: T[],
  keepManualOnCollision: boolean,
): T[] {
  const kept = cur.filter((m) => m.name.trim() && m.source !== SOURCE_BAIZHI);
  const byName = new Map(kept.map((m) => [m.name.trim(), m]));
  const manualNames = new Set(byName.keys());
  for (const e of synced) {
    const name = e.name.trim();
    if (keepManualOnCollision && manualNames.has(name)) continue;
    byName.set(name, e);
  }
  return [...byName.values()];
}

// 归一化保存载荷:save() 与 dirty 比较共用同一形态(名称 trim、default 重算、MCP 序列化)
export const payloadOf = (ms: HostModel[], di: number, mc: McpEntry[], ke: string): HostConfig => ({
  // 显式列出内核支持的字段，避免旧版/实验 UI 字段只写进 config.json、
  // 物化时被静默丢弃，形成“保存成功但完全不生效”的幽灵配置。
  models: modelsToConfig(ms, di),
  mcp_servers: mcpsToServers(mc),
  kernel_env: ke,
});
