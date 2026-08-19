// 设置域 IPC:壳持有的应用配置(get_config / save_config)与设置页伴生
// 命令(提示音、WSL 枚举、日志导出、扩展目录)。
//
// DesktopConfig 契约对表 desktop/src/config.rs::DesktopConfig:壳对 models /
// mcp_servers 零字段知识(serde_json::Value 原样落盘,内核消费),字段语义
// 的权威注释在壳侧;save_config 会重启引擎(引擎横幅自然接管),壳自有偏好
// (pet_* / sound_enabled / telemetry_enabled)在壳内以磁盘值合并——UI 只透传
// 不编辑,免得表单保存把托盘里关掉的开关静默打开。
//
// 浏览器模式语义与旧工程 host.ts 一致:读降级(null / 默认值),写抛
// 「浏览器模式下配置只读」。
import { inDesktopShell, invoke, listen } from "./ipc";

/** 壳配置里的一个模型条目(设置视图编辑,壳原样写盘、内核消费)。 */
export interface HostModel {
  name: string;
  /** anthropic | openai(Chat Completions)| openai_responses(Responses) */
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  default?: boolean;
  /** 上下文窗口(token),高级项;缺省内核按 200k 处理 */
  context_window?: number;
  /** 最大输出(token),高级项;缺省由协议/服务端默认值决定 */
  max_output?: number;
  /** 思考深度默认档:low|medium|high|off;缺省("")= 产品默认「低」 */
  think?: string;
  /** 支持图片输入(视觉) */
  vision?: boolean;
  /** 条目来源("baizhi"/"monkeycode" 同步);缺省 = 手工添加 */
  source?: string;
  /** 超出会员档的展示专用条目:物化跳过、UI 禁选 */
  locked?: boolean;
  /** 会员条目的服务端归属(public/private/team) */
  owner?: string;
}

/** 壳持有的应用配置(config.json 全量;经 get_config/save_config 读写)。 */
export interface DesktopConfig {
  models: HostModel[];
  /** MCP 服务器(name → 配置,与内核 mcp.json 的 mcpServers 同构) */
  mcp_servers: Record<string, unknown>;
  /** 内核运行环境:空/缺省 = 本机;"wsl:<发行版>" = 在 WSL 中运行(仅 Windows) */
  kernel_env?: string;
  /** MonkeyCode 服务地址(自建/私有化;空 = 官方云)。表单外字段,原样透传 */
  mc_base_url?: string;
  /** 测试环境反代的 HTTP Basic Auth("user:pass");表单外字段,原样透传 */
  mc_basic_auth?: string;
  /** 模型请求地址(llmproxy);表单外字段,原样透传 */
  mc_llm_base_url?: string;
  /** 跳过 MonkeyCode 服务的 TLS 证书验证(私有化自签证书;壳侧仅对
   *  服务地址所在域生效,官方云恒验证) */
  mc_skip_tls_verify?: boolean;
  /** 已废弃(单引擎化后壳忽略);历史 config.json 兼容,透传即可 */
  agent_engine?: string;
  /** 壳自有偏好:save_config 时壳以磁盘值合并,UI 透传不编辑 —— */
  pet_enabled?: boolean;
  /** 提示音真值走 sound_enabled/set_sound_enabled 即时命令,不进保存条 */
  sound_enabled?: boolean;
  pet_pos?: [number, number] | null;
  telemetry_enabled?: boolean;
}

/** 读取壳配置;浏览器模式返回 null(设置页据此降级为只读提示)。 */
export async function getConfig(): Promise<DesktopConfig | null> {
  if (!inDesktopShell()) return null;
  return invoke<DesktopConfig>("get_config");
}

/** 保存壳配置:壳写盘并重启引擎(返回时引擎已 Ready 或错误已上抛;
 *  重启过程由引擎横幅外显,UI 无需另行处理)。浏览器模式抛「配置只读」。 */
export async function saveConfig(config: DesktopConfig): Promise<void> {
  if (!inDesktopShell()) throw new Error("浏览器模式下配置只读,请在桌面应用中修改");
  await invoke("save_config", { config });
}

/** 事件提示音开关当前值;浏览器模式(没有桌宠也就没有音效)返回开,
 *  设置页不渲染这一项。 */
export async function getSoundEnabled(): Promise<boolean> {
  if (!inDesktopShell()) return true;
  return invoke<boolean>("sound_enabled");
}

/** 切换提示音:点一下即生效并落盘,不进保存条、不重启引擎。
 *  壳会广播 sound-enabled 让桌宠页与托盘勾选态一起跟上。 */
export async function setSoundEnabled(enabled: boolean): Promise<void> {
  await invoke("set_sound_enabled", { enabled });
}

/** 订阅提示音开关变更(设置页与托盘/桌宠双向同步);非壳环境 no-op。 */
export function onSoundEnabled(cb: (enabled: boolean) => void): () => void {
  return listen<boolean>("sound-enabled", (on) => cb(on !== false));
}

/** 枚举 WSL 发行版(运行环境下拉)。非 Windows/未装 WSL/失败均空数组。 */
export function listWslDistros(): Promise<string[]> {
  if (!inDesktopShell()) return Promise.resolve([]);
  return invoke<string[]>("list_wsl_distros").catch(() => []);
}

/** 导出引擎日志(另存对话框);用户取消或浏览器模式返回 null,
 *  失败抛壳的中文错误(如「引擎日志不存在」),调用方外显。 */
export async function exportEngineLog(): Promise<string | null> {
  if (!inDesktopShell()) return null;
  return invoke<string | null>("export_engine_log");
}

/** 文件管理器中定位随包分发的浏览器扩展目录;返回目录路径,
 *  浏览器模式返回 null,失败抛壳的中文错误。 */
export async function openExtensionDir(): Promise<string | null> {
  if (!inDesktopShell()) return null;
  return invoke<string>("open_extension_dir");
}

/** browser_status 应答:扩展桥的监听/配对/连接状态(设置·浏览器分区展示)。
 *  字段对表壳侧 browser::bridge 的 status()。 */
export interface BrowserExtStatus {
  /** 桥已监听(false 时 error 给不可用原因) */
  enabled: boolean;
  /** 本地连接地址(扩展填端口时用) */
  addr?: string;
  error?: string;
  paired: boolean;
  connected: boolean;
  browser_name?: string;
  browser_version?: string;
  /** 未配对时的一次性配对码(用户填进扩展完成配对) */
  pairing_code?: string;
}

/** 扩展桥状态快照;浏览器模式返回 null(分区据此降级提示)。 */
export async function browserExtStatus(): Promise<BrowserExtStatus | null> {
  if (!inDesktopShell()) return null;
  return invoke<BrowserExtStatus>("browser_status");
}

/** 重新配对:壳清掉受控 tab 集合并换发一次性配对码,返回新状态。 */
export async function browserExtRepair(): Promise<BrowserExtStatus | null> {
  if (!inDesktopShell()) return null;
  return invoke<BrowserExtStatus>("browser_repair");
}
