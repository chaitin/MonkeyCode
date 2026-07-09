import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';

type DouyinAuthResult = {
  code: string;
  grantedPermissions?: string;
  state?: string;
};

type DouyinAuthNativeModule = {
  authorize: (clientKey: string) => Promise<DouyinAuthResult>;
};

const NativeDouyinAuth = NativeModules.DouyinAuth as DouyinAuthNativeModule | undefined;

export function getDouyinClientKey(): string {
  const extra = Constants.expoConfig?.extra as { douyinClientKey?: string } | undefined;
  return (process.env.EXPO_PUBLIC_DOUYIN_CLIENT_KEY || extra?.douyinClientKey || '').trim();
}

export async function authorizeDouyin(): Promise<DouyinAuthResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new Error('当前平台不支持抖音登录');
  }
  if (!NativeDouyinAuth?.authorize) {
    throw new Error('当前安装包不支持抖音登录，请安装最新版本');
  }
  const clientKey = getDouyinClientKey();
  if (!clientKey) {
    throw new Error('缺少抖音 ClientKey 配置');
  }
  const result = await NativeDouyinAuth.authorize(clientKey);
  if (!result?.code) {
    throw new Error('未获取到抖音授权码');
  }
  return result;
}
