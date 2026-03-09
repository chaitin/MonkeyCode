import { Api } from '@/api/Api';
import type { HttpResponse, RequestParams, WebResp } from '@/api/Api';
import { toast } from 'sonner';

export const apiRequest = async (
  apiMethodName: keyof Api<unknown>['api'],
  params: RequestParams | Record<string, any> = {},
  extrax: string[] = [],
  onSuccess?: (data: any) => void,
  onError?: (error: Error) => void,
  formData: Record<string, any> | null = null
): Promise<void> => {
  try {
    const api = new Api();
    
    // 检查API方法是否存在
    if (!api.api[apiMethodName]) {
      throw new Error(`API方法 "${apiMethodName}" 不存在`);
    }

    // 调用API方法
    let response: HttpResponse<any, any>;
    if (formData) {
      response = await (api.api[apiMethodName] as any)(...extrax, params, formData);
    } else {
      response = await (api.api[apiMethodName] as any)(...extrax, params);
    }

    if (response.data?.code === undefined) {
      console.log(response);
      throw new Error('API 返回的数据格式不正确');
    }

    const resp = response.data as WebResp;

    if (onSuccess) {
      onSuccess(resp);
    }
    return;
  } catch (e) {
    if (e instanceof Response && e.status === 401){
      if (window.location.pathname.includes('/console') || window.location.pathname.includes('/manager')) {
        window.location.href = '/login';
      }
      return;
    }

    if (onError) {
      onError(e as Error);
    } else {
      toast.error(`${apiMethodName} 请求失败：${((e as any)?.error) ? (e as any).error.message : (e as Error)?.message || '网络错误'}`);
    }

    console.log(`${apiMethodName} 请求失败：`, e);
  }
};