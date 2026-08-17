// 账号域 IPC:百智云登录(短信/微信扫码/登出/同步)与 MonkeyCode 云账号
// (桥接登录/账密登录/用量/签到/会员模型同步)。契约对表壳侧
// desktop/src/baizhi/{mod.rs,monkeycode.rs}:类型字段名 = 壳响应实形。
//
// - 命令名保持字面量(契约守卫正则,见 ipc.ts 铁律 1);
// - 浏览器模式降级:状态类(baizhiStatus/mcStatus/mcUsage)返回 null,
//   动作类不额外拦截——invoke 直接 reject「非桌面壳环境」,由视图外显;
// - 凭证 cookie 只在壳进程,UI 拿到的都是脱敏后的状态/业务数据。
import { inDesktopShell, invoke } from "./ipc";

// ==================== 百智云 ====================

export interface BaizhiStatus {
  logged_in: boolean;
  /** 账号域主机名(诊断展示) */
  host: string;
  /** 原样 profile(字段对壳不透明,展示名尽力提取,见 profileName) */
  profile?: Record<string, unknown>;
}

/** 微信扫码长轮询单次结果(壳侧最长挂 ~40s,拿到结果立即再调)。 */
export type WechatPollStatus = "waiting" | "scanned" | "canceled" | "expired" | "ok";

/** baizhi_sync 产出的模型条目(不落盘,供 UI 展示/后续并入设置表单)。 */
export interface BaizhiSyncedModel {
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  context_window?: number;
  max_output?: number;
  think?: string;
  vision?: boolean;
  source: string; // "baizhi" | "monkeycode"
  /** monkeycode 同步:服务端模型配置 id(区分同批重名) */
  id?: string;
  /** monkeycode 同步:超会员档,展示禁选 */
  locked?: boolean;
  owner?: string;
}

export interface BaizhiSyncResult {
  models: BaizhiSyncedModel[];
  mcp_servers: Record<string, Record<string, unknown>>;
  /** 本次是否在网关新建了密钥(false = 复用已有) */
  key_created: boolean;
  key_name?: string;
  notes?: string[];
}

/** 百智云会话状态;浏览器模式 null。 */
export async function baizhiStatus(): Promise<BaizhiStatus | null> {
  if (!inDesktopShell()) return null;
  return invoke<BaizhiStatus>("baizhi_status");
}

/** 发送登录短信验证码(壳内自动完成 PoW 验证码)。 */
export const baizhiSendCode = (phone: string) => invoke<{ ok: boolean }>("baizhi_send_code", { phone });

/** 手机号 + 短信验证码登录。 */
export const baizhiLogin = (phone: string, code: string) => invoke<{ ok: boolean }>("baizhi_login", { phone, code });

export const baizhiLogout = () => invoke<{ ok: boolean }>("baizhi_logout");

/** 发起微信扫码会话,返回二维码(data URL,直接给 <img>)。 */
export const baizhiWechatStart = () => invoke<{ qr: string }>("baizhi_wechat_start");

/** 长轮询一次扫码状态;状态机语义见 lib/account/wechatFlow.ts。 */
export const baizhiWechatPoll = () => invoke<{ status: WechatPollStatus }>("baizhi_wechat_poll");

/** 同步模型网关的模型清单与推理密钥(不落盘,纯返回)。knownKeys 传调用方
 *  已持有的候选明文密钥,能对上网关列表就复用,避免每次同步都新建。 */
export const baizhiSync = (knownKeys: string[]) => invoke<BaizhiSyncResult>("baizhi_sync", { knownKeys });

// ==================== MonkeyCode 云账号 ====================

export interface McUser {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
  avatar_url?: string;
}

export interface McStatus {
  logged_in: boolean;
  /** 云端主机名(如 monkeycode-ai.com) */
  host: string;
  /** 完整服务根地址,保留 http/https、端口及部署路径。 */
  base_url?: string;
  user?: McUser;
}

/** 钱包(/api/v1/users/wallet 实形)。 */
export interface McWallet {
  /** 积分余额(展示需 /1000) */
  balance?: number;
  /** 每日免费模型剩余 tokens */
  daily_token_balance?: number;
  /** 每日免费模型 tokens 上限 */
  daily_token_limit?: number;
}

export interface McSubscription {
  /** "basic" | "pro" | "ultra" | "flagship"(flagship 是 ultra 的服务端别名) */
  plan?: string;
  expires_at?: string;
  auto_renew?: boolean;
  source?: string;
}

export interface McInvitation {
  id?: string;
  name?: string;
  /** 可能是相对路径,按 McUsage.base_url 补全 */
  avatar_url?: string;
  credits?: number;
  invited_at?: number;
}

export interface McInvitations {
  count?: number;
  items?: McInvitation[];
}

/** mc_usage 返回:单路缺席各自 null(私有化部署可能只有订阅端点)。 */
export interface McUsage {
  /** 云端服务完整基址(含协议/端口):邀请链接与相对头像地址的解析基准 */
  base_url?: string;
  wallet: McWallet | null;
  subscription: McSubscription | null;
  /** 当天是否已签到;null = 本次没取到(不等于「未签到」,签到入口不出现) */
  checked_in: boolean | null;
  invitations: McInvitations | null;
}

/** mc_models_sync 返回:会员内置模型 → 本地条目(source="monkeycode")。 */
export interface McModelsSyncResult {
  models: BaizhiSyncedModel[];
  /** 被跳过条目的原因(未知协议等),同步提示外显 */
  notes?: string[];
}

/** MonkeyCode 会话状态;浏览器模式 null。 */
export async function mcStatus(): Promise<McStatus | null> {
  if (!inDesktopShell()) return null;
  return invoke<McStatus>("mc_status");
}

/** 桥接登录:用已登录的百智云会话换取 MonkeyCode 会话。 */
export const mcLogin = () => invoke<{ ok: boolean; user?: McUser }>("mc_login");

/** 账号密码直连登录(不经百智云;壳内自动 PoW)。password 原样透传
 *  **不 trim**——首尾空格是密码的一部分(壳侧契约,对齐 mobile/web)。 */
export const mcPasswordLogin = (email: string, password: string) =>
  invoke<{ ok: boolean; user?: McUser }>("mc_password_login", { email, password });

export const mcLogout = () => invoke<{ ok: boolean }>("mc_logout");

/** 账号权益(额度/会员/签到态/邀请);浏览器模式 null。 */
export async function mcUsage(): Promise<McUsage | null> {
  if (!inDesktopShell()) return null;
  return invoke<McUsage>("mc_usage");
}

/** 每日签到(壳内自动 PoW)。成功后调用方重拉 mcUsage 刷新余额。 */
export const mcCheckin = () => invoke<{ ok: boolean }>("mc_checkin");

/** 同步会员内置模型(不落盘,纯返回)。 */
export const mcModelsSync = (expectedGeneration?: number) =>
  invoke<McModelsSyncResult>(
    "mc_models_sync",
    expectedGeneration === undefined ? undefined : { expectedGeneration },
  );

/** 吊销会员模型密钥。须在 mcLogout **之前**调用——请求走 mc 会话认证,
 *  会话一清就没法删了(壳会保留本地记录待重连后收敛)。 */
export const mcModelsRevoke = (expectedGeneration?: number) =>
  invoke<{ ok: boolean }>(
    "mc_models_revoke",
    expectedGeneration === undefined ? undefined : { expectedGeneration },
  );

/** 断开 MonkeyCode。吊销 Key、校验服务代次、清 Cookie 都在壳内完成；
 *  UI 不再做可被切服插入的 check-then-invoke。 */
export async function disconnectMc(expectedGeneration: number): Promise<{ warning?: string; cancelled?: boolean }> {
  const result = await invoke<{ ok: boolean; warning?: string | null; cancelled?: boolean }>(
    "mc_disconnect",
    { expectedGeneration },
  );
  return {
    ...(result.warning ? { warning: result.warning } : {}),
    ...(result.cancelled ? { cancelled: true } : {}),
  };
}
