import { ApiError, authHeaders } from './client';
import { solveChallenges } from './captcha';

export const BAIZHI_BASE_URL = 'https://baizhi.cloud';

const BAIZHI_CLIENT_ID = 'monkeycode-ai';
const BAIZHI_SCOPE = 'user phone';
const BAIZHI_RESPONSE_TYPE = 'code';

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

function readLocation(headers: Headers): string {
  return headers.get('Location') || headers.get('location') || '';
}

function parseQuery(url: string): Record<string, string> {
  const start = url.indexOf('?');
  if (start < 0) return {};
  const hash = url.indexOf('#', start + 1);
  const raw = url.slice(start + 1, hash < 0 ? undefined : hash);
  const params: Record<string, string> = {};
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? '' : part.slice(eq + 1);
    try {
      params[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      params[key] = value;
    }
  }
  return params;
}

function absoluteUrl(location: string, base: string): string {
  if (/^https?:\/\//i.test(location)) return location;
  if (location.startsWith('//')) return `https:${location}`;
  const cleanBase = trimBase(base);
  return location.startsWith('/') ? `${cleanBase}${location}` : `${cleanBase}/${location}`;
}

function originOf(url: string): string {
  const match = trimBase(url).match(/^https?:\/\/[^/]+/i);
  return match ? match[0].toLowerCase() : '';
}

function assertSameOrigin(url: string, base: string): void {
  const urlOrigin = originOf(url);
  const baseOrigin = originOf(base);
  if (!urlOrigin || !baseOrigin || urlOrigin !== baseOrigin) {
    throw new ApiError('百智云回调地址异常，已停止登录');
  }
}

function isBaizhiAuthorizeUrl(url: string): boolean {
  return /^https:\/\/baizhi\.cloud\/oauth\/authorize(?:\?|$)/i.test(url);
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
  const captchaToken = await obtainBaizhiCaptchaToken();
  await baizhiRequest('/api/v1/user/phone_code', {
    method: 'POST',
    body: { phone, kind: 'login', captcha_token: captchaToken },
  });
}

export async function loginBaizhiPhone(phone: string, code: string): Promise<void> {
  const captchaToken = await obtainBaizhiCaptchaToken();
  await baizhiRequest('/api/v1/user/login/phone', {
    method: 'POST',
    body: { phone, code, captcha_token: captchaToken },
  });
}

async function getBaizhiAuthorizeUrl(monkeyCodeBaseUrl: string): Promise<string> {
  const base = trimBase(monkeyCodeBaseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/users/login?redirect=&inviter_id=`, {
      method: 'GET',
      credentials: 'include',
      headers: authHeaders(),
      redirect: 'manual',
    });
  } catch (e) {
    throw new ApiError((e as Error)?.message || '获取百智云授权地址失败，请重试');
  }

  const location = readLocation(res.headers);
  const authorizeLocation = location ? absoluteUrl(location, base) : '';
  if (isBaizhiAuthorizeUrl(authorizeLocation)) return authorizeLocation;
  if (res.url && isBaizhiAuthorizeUrl(res.url)) return res.url;
  if (!res.ok) {
    throw await parseError(res, `获取百智云授权地址失败（${res.status}）`);
  }
  throw new ApiError('未获取到百智云授权地址，请重试', undefined, res.status);
}

function toAuthorizeApiUrl(authorizeUrl: string, monkeyCodeBaseUrl: string): string {
  const params = parseQuery(authorizeUrl);
  if (!params.state) {
    throw new ApiError('百智云授权参数缺失，请重试');
  }
  const redirectUri = params.redirect_uri || params.redirect_url || `${trimBase(monkeyCodeBaseUrl)}/api/v1/users/baizhi/callback`;
  return `${BAIZHI_BASE_URL}/api/v1/oauth/authorize?${buildQuery({
    client_id: params.client_id || BAIZHI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: params.scope || BAIZHI_SCOPE,
    state: params.state,
    response_type: params.response_type || BAIZHI_RESPONSE_TYPE,
  })}`;
}

export async function completeBaizhiOAuth(monkeyCodeBaseUrl: string): Promise<void> {
  const authorizeUrl = await getBaizhiAuthorizeUrl(monkeyCodeBaseUrl);
  const apiUrl = toAuthorizeApiUrl(authorizeUrl, monkeyCodeBaseUrl);
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
    });
  } catch (e) {
    throw new ApiError((e as Error)?.message || '百智云授权失败，请重试');
  }

  if (res.status === 401) {
    throw new ApiError('百智云登录状态已失效，请重新获取验证码登录', undefined, 401);
  }
  if (res.url?.includes('/login?error=')) {
    throw new ApiError('MonkeyCode 登录回调失败，请重试');
  }
  const callbackLocation = readLocation(res.headers);
  if (callbackLocation) {
    const callbackUrl = absoluteUrl(callbackLocation, monkeyCodeBaseUrl);
    assertSameOrigin(callbackUrl, monkeyCodeBaseUrl);
    let callbackRes: Response;
    try {
      callbackRes = await fetch(callbackUrl, {
        method: 'GET',
        credentials: 'include',
        headers: authHeaders(),
        redirect: 'follow',
      });
    } catch (e) {
      throw new ApiError((e as Error)?.message || 'MonkeyCode 登录回调失败，请重试');
    }
    if (callbackRes.url?.includes('/login?error=')) {
      throw new ApiError('MonkeyCode 登录回调失败，请重试');
    }
    if (!callbackRes.ok) {
      throw await parseError(callbackRes, `MonkeyCode 登录回调失败（${callbackRes.status}）`);
    }
    return;
  }
  if (!res.ok) {
    throw await parseError(res, `百智云授权失败（${res.status}）`);
  }
}
