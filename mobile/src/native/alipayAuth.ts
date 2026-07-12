import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';

const STORAGE_PENDING_REQUEST = 'mc.alipayAuthRequest';

export type AlipayAuthResult = {
  code: string;
  resultStatus?: string;
  resultCode?: string;
  userId?: string;
};

type AlipayAuthNativeModule = {
  authorize: (authInfo: string, scheme?: string) => Promise<AlipayAuthResult>;
  consumePendingResult?: () => Promise<AlipayAuthResult | null>;
};

type PendingRequest = {
  requestId: string;
  createdAt: number;
  expiresAt: number;
};

const NativeAlipayAuth = NativeModules.AlipayAuth as AlipayAuthNativeModule | undefined;

export function getAlipayScheme(): string {
  const extra = Constants.expoConfig?.extra as { alipayScheme?: string } | undefined;
  return (process.env.EXPO_PUBLIC_ALIPAY_SCHEME || extra?.alipayScheme || 'com.chaitin.baizhi.monkeycode.alipay').trim();
}

function ensureSupported() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('当前平台不支持支付宝登录');
  }
  if (!NativeAlipayAuth?.authorize) {
    throw new Error('当前安装包不支持支付宝登录，请安装最新版本');
  }
}

async function savePendingRequest(requestId: string, expiresAt?: string | number): Promise<void> {
  const parsedSeconds = Number(expiresAt);
  const parsedExpiry = Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds * 1000 : 0;
  const pending: PendingRequest = {
    requestId,
    createdAt: Date.now(),
    expiresAt: parsedExpiry || Date.now() + 5 * 60 * 1000,
  };
  await AsyncStorage.setItem(STORAGE_PENDING_REQUEST, JSON.stringify(pending));
}

async function readPendingRequest(): Promise<PendingRequest | null> {
  const value = await AsyncStorage.getItem(STORAGE_PENDING_REQUEST);
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as PendingRequest;
    if (!pending.requestId || !pending.expiresAt || Date.now() >= pending.expiresAt) {
      await clearPendingAlipayAuthorization();
      return null;
    }
    return pending;
  } catch {
    await clearPendingAlipayAuthorization();
    return null;
  }
}

export async function authorizeAlipay(authInfo: string, requestId: string, expiresAt?: string | number): Promise<AlipayAuthResult> {
  ensureSupported();
  const cleanAuthInfo = authInfo.trim();
  const cleanRequestId = requestId.trim();
  if (!cleanAuthInfo) throw new Error('未获取到支付宝授权参数');
  if (!cleanRequestId) throw new Error('未获取到支付宝授权请求 ID');

  await savePendingRequest(cleanRequestId, expiresAt);
  try {
    const result = Platform.OS === 'ios'
      ? await NativeAlipayAuth!.authorize(cleanAuthInfo, getAlipayScheme())
      : await NativeAlipayAuth!.authorize(cleanAuthInfo);
    if (!result?.code) throw new Error('未获取到支付宝授权码');
    return result;
  } catch (error) {
    await clearPendingAlipayAuthorization();
    throw error;
  }
}

export async function consumePendingAlipayAuthorization(): Promise<(AlipayAuthResult & { requestId: string }) | null> {
  if (Platform.OS !== 'ios' || !NativeAlipayAuth?.consumePendingResult) return null;
  const pending = await readPendingRequest();
  if (!pending) return null;
  try {
    // 冷启动时 AppDelegate 可能比 React 页面稍早或稍晚收到支付宝回跳，短暂轮询消除竞态。
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await NativeAlipayAuth.consumePendingResult();
      if (result?.code) return { ...result, requestId: pending.requestId };
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  } catch (error) {
    await clearPendingAlipayAuthorization();
    throw error;
  }
}

export async function clearPendingAlipayAuthorization(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_PENDING_REQUEST);
}
