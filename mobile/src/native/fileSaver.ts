import { NativeModules, Platform } from 'react-native';

type FileSaverNativeModule = {
  saveFile(sourceUri: string, suggestedName: string, mimeType: string): Promise<string | null>;
};

const NativeFileSaver = NativeModules.FileSaver as FileSaverNativeModule | undefined;

export function isNativeFileSaverAvailable(): boolean {
  return Platform.OS === 'android' && typeof NativeFileSaver?.saveFile === 'function';
}

/** 打开 Android 系统“创建文档”界面，并把应用缓存文件复制到用户选择的位置。取消时返回 null。 */
export async function saveFileToDevice(
  sourceUri: string,
  suggestedName: string,
  mimeType: string,
): Promise<string | null> {
  if (!isNativeFileSaverAvailable()) throw new Error('系统保存功能不可用');
  return NativeFileSaver!.saveFile(sourceUri, suggestedName, mimeType);
}
