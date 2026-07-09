import { ApiError } from './client';
import { solveChallenges } from './captcha';

export const BAIZHI_BASE_URL = 'https://baizhi.cloud';

interface ChallengeResp {
  challenge: { c: number; s: number; d: number };
  token: string;
  expires?: number;
}

interface RedeemResp {
  success: boolean;
  token?: string;
  message?: string;
  expires?: number;
}

interface BaizhiEnvelope<T = unknown> {
  code?: number;
  message?: string;
  success?: boolean;
  data?: T;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function trimBase(url: string) {
  return url.trim().replace(/\/+$/, '');
}

function buildQuery(query: Query): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

async function parseError(res: Response, fallback: string): Promise<ApiError> {
  let message = fallback;
  let code: number | undefined;
  try {
    const json = (await res.json()) as BaizhiEnvelope;
    message = json.message || message;
    code = json.code;
  } catch {
    try {
      const text = await res.text();
      if (text.trim()) message = text.trim();
    } catch {
      /* keep fallback */
    }
  }
  return new ApiError(message.replace(/\s*\[trace_id:[^\]]+\]\s*$/i, '').trim(), code, res.status);
}

async function baizhiRequest<T = unknown>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; query?: Query } = {},
): Promise<T> {
  const { method = 'GET', body, query } = opts;
  const qs = query ? buildQuery(query) : '';
  let res: Response;
  try {
    res = await fetch(`${BAIZHI_BASE_URL}${path}${qs ? `?${qs}` : ''}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError((e as Error)?.message || '百智云网络请求失败');
  }

  let json: BaizhiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as BaizhiEnvelope<T>;
  } catch {
    if (!res.ok) throw await parseError(res, `百智云请求失败（${res.status}）`);
    return undefined as T;
  }

  if (!res.ok || (typeof json.code === 'number' && json.code !== 0) || json.success === false) {
    const message = json.message || `百智云请求失败（${res.status}）`;
    throw new ApiError(message.replace(/\s*\[trace_id:[^\]]+\]\s*$/i, '').trim(), json.code, res.status);
  }
  return (json.data ?? json) as T;
}

async function obtainBaizhiCaptchaToken(): Promise<string> {
  const jsonHeaders = { 'Content-Type': 'application/json' };
  const challengeRes = await fetch(`${BAIZHI_BASE_URL}/api/v1/public/captcha/challenge`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
  });
  if (!challengeRes.ok) {
    throw new ApiError(`获取百智云验证码失败（${challengeRes.status}）`, undefined, challengeRes.status);
  }
  const challenge = (await challengeRes.json()) as ChallengeResp;
  if (!challenge?.token || !challenge?.challenge) {
    throw new ApiError('百智云验证码响应格式异常');
  }

  const redeemRes = await fetch(`${BAIZHI_BASE_URL}/api/v1/public/captcha/redeem`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ token: challenge.token, solutions: solveChallenges(challenge) }),
  });
  const redeem = (await redeemRes.json()) as RedeemResp;
  if (!redeemRes.ok || !redeem?.success || !redeem.token) {
    throw new ApiError(redeem?.message || '百智云验证码校验失败', undefined, redeemRes.status);
  }
  return redeem.token;
}

export async function sendBaizhiPhoneCode(phone: string): Promise<void> {
  await sendBaizhiPhoneCodeForToken(phone);
}

export async function sendBaizhiPhoneCodeForToken(phone: string, token?: string): Promise<void> {
  const captchaToken = await obtainBaizhiCaptchaToken();
  await baizhiRequest('/api/v1/user/phone_code', {
    method: 'POST',
    body: { phone, kind: 'login', token, captcha_token: captchaToken },
  });
}

export async function loginBaizhiPhone(phone: string, code: string): Promise<void> {
  const captchaToken = await obtainBaizhiCaptchaToken();
  await baizhiRequest('/api/v1/user/login/phone', {
    method: 'POST',
    body: { phone, code, captcha_token: captchaToken },
  });
}

export async function loginBaizhiDouyinApp(code: string): Promise<void> {
  await baizhiRequest('/api/v1/user/oauth/app-login', {
    method: 'POST',
    body: { platform: 'douyin_app', code },
  });
}

interface OAuthURLResp {
  url?: string;
}

export type BaizhiOAuthPlatform = 'github';

export async function getBaizhiOAuthLoginUrl(platform: BaizhiOAuthPlatform, redirectUrl: string): Promise<string> {
  const resp = await baizhiRequest<OAuthURLResp>('/api/v1/user/oauth/login', {
    query: { platform, redirect_url: redirectUrl },
  });
  if (!resp?.url) throw new ApiError('未获取到授权地址，请重试');
  return resp.url;
}

export function getMonkeyCodeBaizhiLoginUrl(monkeyCodeBaseUrl: string): string {
  return `${trimBase(monkeyCodeBaseUrl)}/api/v1/users/login?redirect=&inviter_id=`;
}
