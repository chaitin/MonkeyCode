// 百智云账号域(网络层;视图在 baizhi.tsx):壳原生实现,凭证 cookie 不出
// 壳进程。IPC 原语在 ipc.ts,载荷纯数据类型在 types.ts。
import { invoke } from "./ipc";
import type { BaizhiStatus, BaizhiSyncResult } from "./types";

export const baizhiStatus = () => invoke<BaizhiStatus>("baizhi_status");

export const baizhiSendCode = (phone: string) =>
  invoke<{ ok: boolean }>("baizhi_send_code", { phone });

export const baizhiLogin = (phone: string, code: string) =>
  invoke<{ ok: boolean }>("baizhi_login", { phone, code });

export const baizhiLogout = () => invoke<{ ok: boolean }>("baizhi_logout");

/** 发起微信扫码会话,返回二维码(data URL,直接给 <img>)。 */
export const baizhiWechatStart = () => invoke<{ qr: string }>("baizhi_wechat_start");

/** 长轮询一次扫码状态(壳侧最长挂 ~40s,拿到结果立即再调)。
 * status: waiting | scanned | canceled | expired | ok(ok 即登录完成)。 */
export const baizhiWechatPoll = () =>
  invoke<{ status: "waiting" | "scanned" | "canceled" | "expired" | "ok" }>("baizhi_wechat_poll");

/** 同步模型网关的模型清单与推理密钥。knownKeys 传设置表单里已有的
 * api_key(能对上网关密钥列表就复用,避免每次同步都新建密钥)。
 * 返回结构供 UI 展示并合并进设置表单,由用户确认后保存。 */
export const baizhiSync = (knownKeys: string[]) =>
  invoke<BaizhiSyncResult>("baizhi_sync", { knownKeys });
