import { Api } from '@/api/Api';
import type { HttpResponse, WebResp } from '@/api/Api';
import { toast } from 'sonner';

type ApiInstance = Api<unknown>;
type ApiMethods = ApiInstance['api'];
type ApiMethodName = keyof ApiMethods;
type ApiMethod<M extends ApiMethodName> = ApiMethods[M] extends (...args: infer A) => infer R ? (...args: A) => R : never;
type ApiMethodResponse<M extends ApiMethodName> = Awaited<ReturnType<ApiMethod<M>>>;
type ApiMethodData<M extends ApiMethodName> = ApiMethodResponse<M> extends HttpResponse<infer D, unknown> ? D : unknown;
type ApiMethodArgs<M extends ApiMethodName> = Parameters<ApiMethod<M>>;

type StartsWith<Args extends readonly unknown[], Prefix extends readonly unknown[]> =
  Args extends [...Prefix, ...unknown[]] ? Prefix : never;

type ArgAt<Args extends readonly unknown[], Index extends number> =
  Args extends { [K in Index]: infer V } ? V : never;

type ApiMethodParamArg<M extends ApiMethodName, E extends readonly unknown[]> = ArgAt<ApiMethodArgs<M>, E['length']>;

type WebRespWithData<D = unknown> = Omit<WebResp, 'data'> & { data?: D };
type WithData<R, D = unknown> = R extends { data?: unknown } ? Omit<R, 'data'> & { data?: D } : R;
/**
 * 默认情况下（不显式指定 D），保持 OpenAPI 生成的 data 类型。
 * 只有显式指定 D 时，才覆写 resp.data 的类型。
 */
type ApiMethodWebResp<M extends ApiMethodName, D = never> = ApiMethodData<M> extends { code?: number }
  ? ([D] extends [never] ? ApiMethodData<M> : WithData<ApiMethodData<M>, D>)
  : ([D] extends [never] ? WebResp : WebRespWithData<D>);

const ensureWebResp = (apiMethodName: string, data: unknown): WebResp => {
  const maybe = data as Partial<WebResp> | null | undefined;
  if (maybe?.code === undefined) {
    console.log(data);
    throw new Error(`API 返回的数据格式不正确 (${apiMethodName})`);
  }
  return maybe as WebResp;
};

const handleUnauthorized = () => {
  const loc = globalThis.location;
  if (loc?.pathname?.includes('/console') || loc?.pathname?.includes('/manager')) {
    loc.href = '/login';
  }
};

const getErrorMessage = (e: unknown) => {
  const anyErr = e as { error?: { message?: string } } | null | undefined;
  return anyErr?.error?.message ?? (e instanceof Error ? e.message : '网络错误');
};

export function apiRequest<M extends ApiMethodName, E extends readonly unknown[] = [], D = never>(
  apiMethodName: M,
  params: ApiMethodParamArg<M, E>,
  extrax: E & StartsWith<ApiMethodArgs<M>, E>,
  onSuccess?: (resp: ApiMethodWebResp<M, D>) => void,
  onError?: (error: Error) => void,
  formData?: Record<string, unknown> | null,
): Promise<ApiMethodWebResp<M, D> | undefined>;

export async function apiRequest<M extends ApiMethodName, E extends readonly unknown[] = [], D = never>(
  apiMethodName: M,
  params: ApiMethodParamArg<M, E>,
  extrax: E & StartsWith<ApiMethodArgs<M>, E>,
  onSuccess?: (resp: ApiMethodWebResp<M, D>) => void,
  onError?: (error: Error) => void,
  formData: Record<string, unknown> | null = null,
): Promise<ApiMethodWebResp<M, D> | undefined> {
  try {
    const api = new Api();
    
    // 检查API方法是否存在
    if (!api.api[apiMethodName]) {
      throw new Error(`API方法 "${apiMethodName}" 不存在`);
    }

    // 调用API方法
    let response: HttpResponse<unknown, unknown>;
    if (formData) {
      response = await (api.api[apiMethodName] as (...args: unknown[]) => Promise<HttpResponse<unknown, unknown>>)(...extrax, params, formData);
    } else {
      response = await (api.api[apiMethodName] as (...args: unknown[]) => Promise<HttpResponse<unknown, unknown>>)(...extrax, params);
    }

    ensureWebResp(String(apiMethodName), response.data);

    const resp = response.data as ApiMethodWebResp<M, D>;

    if (onSuccess) {
      onSuccess(resp);
    }
    return resp;
  } catch (e) {
    if (e instanceof Response && e.status === 401){
      handleUnauthorized();
      return undefined;
    }

    if (onError) {
      onError(e as Error);
    } else {
      const msg = getErrorMessage(e);
      toast.error(`${apiMethodName} 请求失败：${msg}`);
    }

    console.log(`${apiMethodName} 请求失败：`, e);
    return undefined;
  }
};