import { Api } from '@/api/Api';
import type { HttpResponse, RequestParams, GithubComGoYokoWebResp } from '@/api/Api';
import { toast } from 'sonner';
import i18n from '@/i18n';

function requestText(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(`requestUtils.${key}`, options));
}

function getRequestErrorMessage(error: unknown): string {
  const errorLike = error as { error?: { message?: string }; message?: string };
  return errorLike.error?.message || errorLike.message || requestText('errors.network');
}

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
    
    if (!api.api[apiMethodName]) {
      throw new Error(requestText('errors.methodMissing', { method: apiMethodName }));
    }

    let response: HttpResponse<any, any>;
    if (formData) {
      response = await (api.api[apiMethodName] as any)(...extrax, params, formData);
    } else {
      response = await (api.api[apiMethodName] as any)(...extrax, params);
    }

    if (response.data?.code === undefined) {
      console.log(response);
      throw new Error(requestText('errors.invalidResponse'));
    }

    const resp = response.data as GithubComGoYokoWebResp;

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
      toast.error(requestText('toast.requestFailed', {
        method: apiMethodName,
        message: getRequestErrorMessage(e),
      }));
    }

    console.log(`${apiMethodName} request failed:`, e);
  }
};
