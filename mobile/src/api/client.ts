/**
 * 轻量 HTTP 客户端。
 *
 * 鉴权沿用 Web 端的会话 Cookie（monkeycode_ai_session）。React Native 的原生网络层
 * （iOS NSURLSession / Android OkHttp）会自动持久化并回传 Cookie，因此登录成功后
 * 后续请求无需手动携带 token。
 */
import type {
  AddGitIdentityReq,
  ApiEnvelope,
  CheckModelResp,
  CreateModelReq,
  CreateProjectReq,
  CreateTaskReq,
  GitIdentity,
  Image,
  InvitationListResp,
  ListProjectResp,
  ListTaskResp,
  Model,
  OAuthURLResp,
  Project,
  ProjectTask,
  ProviderModelItem,
  Skill,
  Subscription,
  TaskRoundsResp,
  UpdateGitIdentityReq,
  UpdateModelReq,
  UserStatus,
  Wallet,
} from './types';
import { base64Encode } from '@/messages/base64';

export const DEFAULT_BASE_URL = 'https://monkeycode-ai.com';

let baseUrl = DEFAULT_BASE_URL;
let basicAuth = ''; // 形如 "user:pass"，用于连接带 HTTP Basic Auth 的测试环境（反向代理层鉴权）
let onUnauthorized: (() => void) | null = null;

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/+$/, '');
}
export function getBaseUrl() {
  return baseUrl;
}

export function setBasicAuth(v: string) {
  basicAuth = (v || '').trim();
}
export function getBasicAuth() {
  return basicAuth;
}
/** 测试环境的 Basic Auth 头（未设置时为空对象，可安全展开）。 */
export function authHeaders(): Record<string, string> {
  if (!basicAuth) return {};
  // 用应用自带的 base64（不依赖 btoa —— Hermes 上 btoa 可能缺失，会让 Basic Auth 头静默丢失，
  // 表现为 Android 下载 401 而 iOS 因系统凭据缓存仍可用）。
  return { Authorization: `Basic ${base64Encode(basicAuth)}` };
}
/** 拆出 Basic Auth 的用户名/密码（给 WebView 的 basicAuthCredential 用）。 */
export function basicAuthCredential(): { username: string; password: string } | undefined {
  if (!basicAuth) return undefined;
  const i = basicAuth.indexOf(':');
  return i < 0 ? { username: basicAuth, password: '' } : { username: basicAuth.slice(0, i), password: basicAuth.slice(i + 1) };
}

/**
 * 建一个带 Basic Auth 头的 WebSocket。
 * RN 的 WebSocket 支持第三个 options 参数透传请求头（TS 类型未声明，故 cast）；
 * 没设置 Basic Auth 时 headers 为空对象，无副作用。
 */
export function openWebSocket(url: string): WebSocket {
  const WS = WebSocket as unknown as { new (url: string, protocols: undefined, options: { headers: Record<string, string> }): WebSocket };
  return new WS(url, undefined, { headers: authHeaders() });
}

/**
 * 把可能是相对路径的资源地址（头像等）解析成绝对地址。
 * 浏览器里相对地址会按同源自动补全，但 RN 的 <Image> 必须是绝对地址。
 */
export function resolveAssetUrl(url?: string | null): string | undefined {
  const u = (url || '').trim();
  if (!u) return undefined;
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:')) return u; // 已是绝对地址 / data URI
  const b = baseUrl.replace(/\/+$/, '');
  return u.startsWith('/') ? `${b}${u}` : `${b}/${u}`;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/**
 * 文件下载地址（开发环境内的文件/目录）。vmId 取 task.virtualmachine.id；目录会被
 * 后端自动打包成 zip（前端只需把文件名命名为 .zip）。鉴权沿用会话 Cookie，
 * 测试环境的 Basic Auth 头由调用方通过 authHeaders() 附加。
 */
export function getDownloadUrl(vmId: string, path: string, filename?: string): string {
  return `${baseUrl}/api/v1/users/files/download${buildQuery({ id: vmId, path, filename })}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildQuery(query?: Query): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** multipart 请求体；不要手动设置 Content-Type，RN 会自动补 boundary。 */
  formData?: FormData;
  signal?: AbortSignal;
  onUploadProgress?: (loaded: number, total: number | null) => void;
}

function requestWithUploadProgress<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  formData: FormData,
  signal: AbortSignal | undefined,
  onUploadProgress: (loaded: number, total: number | null) => void,
): Promise<ApiEnvelope<T>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('请求已取消'));
      return;
    }

    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: ApiError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (envelope: ApiEnvelope<T>) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(envelope);
    };
    const abort = () => {
      xhr.abort();
      fail(new ApiError('请求已取消'));
    };

    xhr.open(method, url, true);
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      onUploadProgress(event.loaded, event.lengthComputable && event.total > 0 ? event.total : null);
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        onUnauthorized?.();
        fail(new ApiError('登录已过期，请重新登录', undefined, 401));
        return;
      }

      let json: ApiEnvelope<T> | null = null;
      if (xhr.responseText) {
        try {
          json = JSON.parse(xhr.responseText) as ApiEnvelope<T>;
        } catch {
          if (xhr.status < 200 || xhr.status >= 300) {
            fail(new ApiError(`请求失败（${xhr.status}）`, undefined, xhr.status));
            return;
          }
        }
      }
      if (json && typeof json.code === 'number' && json.code !== 0) {
        fail(new ApiError(json.message || '请求失败', json.code, xhr.status));
        return;
      }
      if ((xhr.status < 200 || xhr.status >= 300) && (!json || typeof json.code !== 'number')) {
        fail(new ApiError(`请求失败（${xhr.status}）`, undefined, xhr.status));
        return;
      }
      succeed(json ?? ({ code: 0 } as ApiEnvelope<T>));
    };
    xhr.onerror = () => fail(new ApiError('网络错误'));
    xhr.onabort = () => fail(new ApiError('请求已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(formData);
  });
}

export async function request<T = unknown>(
  path: string,
  opts: RequestOpts = {},
): Promise<ApiEnvelope<T>> {
  const { method = 'GET', query, body, formData, signal, onUploadProgress } = opts;
  const url = `${baseUrl}${path}${buildQuery(query)}`;

  const headers: Record<string, string> = { ...authHeaders() };
  if (body) headers['Content-Type'] = 'application/json';
  if (formData && onUploadProgress) {
    return requestWithUploadProgress<T>(url, method, headers, formData, signal, onUploadProgress);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: formData ?? (body != null ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (e) {
    throw new ApiError((e as Error)?.message || '网络错误');
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError('登录已过期，请重新登录', undefined, 401);
  }

  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // 某些接口（如登录）成功时也会返回标准信封；解析失败按状态码处理
    if (!res.ok) {
      throw new ApiError(`请求失败（${res.status}）`, undefined, res.status);
    }
    return { code: 0 } as ApiEnvelope<T>;
  }

  if (json && typeof json.code === 'number' && json.code !== 0) {
    throw new ApiError(json.message || '请求失败', json.code, res.status);
  }
  if (!res.ok && (!json || typeof json.code !== 'number')) {
    throw new ApiError(`请求失败（${res.status}）`, undefined, res.status);
  }
  return json as ApiEnvelope<T>;
}

/* ----------------------------- 具体接口 ----------------------------- */

export function login(email: string, password: string, captchaToken: string) {
  return request<UserStatus>('/api/v1/users/password-login', {
    method: 'POST',
    body: { email, password, captcha_token: captchaToken },
  });
}

/**
 * Sign in with Apple（App Store 审核 Guideline 4.8 要求）。
 * 客户端把 Apple 下发的 identity_token（JWT）交给后端；后端用 Apple 公钥验签
 * （iss=https://appleid.apple.com，aud=应用 Bundle ID），以 token 里的 sub 作为
 * 稳定用户标识创建/关联账号，成功后写入会话 Cookie（与密码登录一致）。
 * full_name 仅在用户首次授权时由 Apple 提供，供建号时初始化昵称；邮箱以 identity token
 * 里 Apple 验签的 claim 为准，客户端不自报。
 */
export function appleLogin(params: {
  identity_token: string;
  authorization_code?: string;
  full_name?: string;
}) {
  return request<UserStatus>('/api/v1/users/apple-login', {
    method: 'POST',
    body: params,
  });
}

export function logout() {
  return request('/api/v1/users/logout', { method: 'POST' }).catch(() => undefined);
}

/**
 * 注销账号（App Store Guideline 5.1.1(v)：支持建号就必须支持删号）。
 * 后端负责删除账号及关联数据并使所有会话失效；Apple 登录建的号还需由后端
 * 调用 Apple 的 token revoke 接口撤销授权。失败时抛 ApiError（如旧版自托管
 * 后端没有此接口）。
 */
export function deleteAccount() {
  return request('/api/v1/users/account', { method: 'DELETE' });
}

export async function getUserStatus(): Promise<UserStatus> {
  const resp = await request<{ user?: UserStatus }>('/api/v1/users/status');
  return resp.data?.user ?? {};
}

/** 发送邮箱绑定验证邮件。验证链接被点击后，后端才会把邮箱写入用户信息。 */
export function sendBindEmailVerification(email: string) {
  return request('/api/v1/users/email/bind-request', {
    method: 'PUT',
    body: { email },
  });
}

export async function getWallet(): Promise<Wallet | null> {
  const resp = await request<Wallet>('/api/v1/users/wallet');
  return resp.data ?? null;
}

/** 当天是否已签到。 */
export async function getCheckinStatus(): Promise<boolean> {
  const resp = await request<{ checked_in?: boolean }>('/api/v1/users/wallet/checkin');
  return resp.data?.checked_in === true;
}

/** 每日签到领取积分（每天 1 次，需 captcha_token）。失败时抛 ApiError。 */
export async function submitCheckin(captchaToken: string): Promise<void> {
  await request('/api/v1/users/wallet/checkin', { method: 'POST', body: { captcha_token: captchaToken } });
}

export async function getSubscription(): Promise<Subscription | null> {
  const resp = await request<Subscription>('/api/v1/users/subscription');
  return resp.data ?? null;
}

export async function listInvitations(params: { page?: number; size?: number } = {}): Promise<{ count: number; items: NonNullable<InvitationListResp['items']> }> {
  const resp = await request<InvitationListResp>('/api/v1/users/invitations', { query: { page: 1, size: 50, ...params } });
  const items = resp.data?.items ?? [];
  return { count: resp.data?.count ?? items.length, items };
}

/** 任务数（读 page_info.total）。传 project_id 即为该项目下的任务数，可再按 status 过滤。 */
export async function getTaskCount(params: { project_id?: string; status?: string } = {}): Promise<number> {
  const resp = await request<ListTaskResp>('/api/v1/users/tasks', { query: { page: 1, size: 1, ...params } });
  const pi = resp.data?.page_info;
  return pi?.total_count ?? pi?.total ?? resp.data?.tasks?.length ?? 0;
}

export async function listTasks(params: {
  page?: number;
  size?: number;
  status?: string;
  project_id?: string;
}): Promise<ProjectTask[]> {
  const resp = await request<ListTaskResp>('/api/v1/users/tasks', { query: params });
  return resp.data?.tasks ?? [];
}

export async function listProjects(params: {
  cursor?: string;
  limit?: number;
} = {}): Promise<{ projects: Project[]; nextCursor?: string; hasMore: boolean }> {
  const resp = await request<ListProjectResp>('/api/v1/users/projects', { query: params });
  return {
    projects: resp.data?.projects ?? [],
    nextCursor: resp.data?.page?.cursor,
    hasMore: !!resp.data?.page?.has_more,
  };
}

export async function getProjectDetail(id: string): Promise<Project | null> {
  const resp = await request<Project>(`/api/v1/users/projects/${id}`);
  return resp.data ?? null;
}

/** 创建项目（关联一个已绑定的 Git 身份 + 仓库）。对齐 Web add-project。 */
export async function createProject(req: CreateProjectReq): Promise<Project | null> {
  const resp = await request<Project>('/api/v1/users/projects', { method: 'POST', body: req });
  return resp.data ?? null;
}

/* ----------------------------- Git 身份 ----------------------------- */

/** 当前用户的 Git 身份列表（过滤系统内部身份，与 Web data-provider 一致）。 */
export async function listGitIdentities(): Promise<GitIdentity[]> {
  const resp = await request<GitIdentity[]>('/api/v1/users/git-identities');
  return (resp.data ?? []).filter((i) => i.platform !== 'internal');
}

/** 单个 Git 身份详情，含 authorized_repositories；flush=true 刷新远端仓库缓存。 */
export async function getGitIdentity(id: string, flush = false): Promise<GitIdentity | null> {
  const resp = await request<GitIdentity>(`/api/v1/users/git-identities/${id}`, { query: { flush } });
  return resp.data ?? null;
}

/** 手动绑定 Git 身份（填写 Access Token 方式）。 */
export async function addGitIdentity(req: AddGitIdentityReq): Promise<GitIdentity | null> {
  const resp = await request<GitIdentity>('/api/v1/users/git-identities', { method: 'POST', body: req });
  return resp.data ?? null;
}

/** 更新 Git 身份（只传需变更的字段；platform/base_url 不可改，access_token 留空表示不动）。 */
export function updateGitIdentity(id: string, req: UpdateGitIdentityReq) {
  return request(`/api/v1/users/git-identities/${id}`, { method: 'PUT', body: req });
}

/** 移除 Git 身份。被项目占用时后端返回 409。 */
export function deleteGitIdentity(id: string) {
  return request(`/api/v1/users/git-identities/${id}`, { method: 'DELETE' });
}

/**
 * 获取第三方平台 OAuth 授权地址（gitee / gitea / gitlab）。
 * 由当前会话 Cookie 关联用户，返回的 url 在 WebView 里打开完成授权。GitLab 需传 base 指定实例。
 */
export async function getGitOAuthUrl(platform: string, base?: string): Promise<string> {
  const resp = await request<OAuthURLResp>(`/api/v1/${platform}/authorize_url`, { query: base ? { base } : undefined });
  return resp.data?.url ?? '';
}

export async function getTaskDetail(id: string): Promise<ProjectTask | null> {
  const resp = await request<ProjectTask>(`/api/v1/users/tasks/${id}`);
  return resp.data ?? null;
}

export async function getTaskRounds(params: {
  id: string;
  limit?: number;
  cursor?: string;
}): Promise<TaskRoundsResp> {
  const resp = await request<TaskRoundsResp>('/api/v1/users/tasks/rounds', { query: params });
  return resp.data ?? {};
}

export async function listModels(): Promise<Model[]> {
  const resp = await request<{ models?: Model[] }>('/api/v1/users/models');
  return resp.data?.models ?? [];
}

/** 创建当前用户的自有模型配置。 */
export async function createModel(req: CreateModelReq): Promise<Model | null> {
  const resp = await request<Model>('/api/v1/users/models', { method: 'POST', body: req });
  return resp.data ?? null;
}

export function updateModel(id: string, req: UpdateModelReq) {
  return request(`/api/v1/users/models/${id}`, { method: 'PUT', body: req });
}

export function deleteModel(id: string) {
  return request(`/api/v1/users/models/${id}`, { method: 'DELETE' });
}

/** 按配置做健康检查（不落库），保存前校验配置可用性。 */
export async function checkModelConfig(req: Pick<CreateModelReq, 'provider' | 'model' | 'base_url' | 'api_key' | 'interface_type'>): Promise<CheckModelResp> {
  const resp = await request<CheckModelResp>('/api/v1/users/models/health-check', { method: 'POST', body: req });
  return resp.data ?? {};
}

/** 拉取供应商支持的模型列表（拉不到时由调用方回退为手动输入）。 */
export async function listProviderModels(params: { api_key: string; base_url: string; provider: string }): Promise<ProviderModelItem[]> {
  const resp = await request<{ models?: ProviderModelItem[]; error?: { message?: string } }>('/api/v1/users/models/providers', { query: params });
  return resp.data?.models ?? [];
}

export async function listImages(): Promise<Image[]> {
  const resp = await request<{ images?: Image[] }>('/api/v1/users/images');
  return resp.data?.images ?? [];
}

export async function listSkills(): Promise<Skill[]> {
  const resp = await request<Skill[]>('/api/v1/skills');
  return (resp.data as Skill[]) ?? [];
}

export async function createTask(req: CreateTaskReq): Promise<ProjectTask | null> {
  const resp = await request<ProjectTask>('/api/v1/users/tasks', { method: 'POST', body: req });
  return resp.data ?? null;
}

export function stopTask(id: string) {
  return request('/api/v1/users/tasks/stop', { method: 'PUT', body: { id } });
}

export function deleteTask(id: string) {
  return request(`/api/v1/users/tasks/${id}`, { method: 'DELETE' });
}
