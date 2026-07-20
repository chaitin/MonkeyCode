/**
 * 图片附件 / zip 文件：选择 + 上传。对齐 Web 端「预签名直传」流程：
 *   1) POST /api/v1/uploader/presign { filename } -> { access_url, upload_url }
 *   2) PUT 原始字节到 upload_url（预签名 URL 自带鉴权，不需要 cookie）
 *   3) 发消息时带上 { url: access_url, filename }
 * 任务工作区文件则走 /users/files/upload multipart 直传到 VM。
 * 约束与 Web 对齐：图片单张 ≤2MB、最多 3 张；zip / 工作区文件 ≤10MB。
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { request } from './client';

export const MAX_ATTACHMENTS = 3;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB（与 Web MAX_UPLOAD_FILE_SIZE 一致）
export const MAX_ZIP_BYTES = 10 * 1024 * 1024; // 10MB（与 Web 端 zip 上传限制一致）
export const MAX_WORKSPACE_FILE_BYTES = 10 * 1024 * 1024; // 10MB（与 Web 工作区文件上传一致）

export interface PickedImage {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  width?: number;
}

export interface UploadedAttachment {
  url: string;
  filename: string;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

let pendingZipPick: Promise<PickedFile | null> | null = null;
let pendingWorkspaceFilePick: Promise<PickedFile | null> | null = null;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** 取一个带扩展名的文件名（后端按文件名推断类型）：优先用系统给的，其次从 uri 末段，最后按 mime 造一个。 */
function fileNameFor(asset: ImagePicker.ImagePickerAsset, index: number): string {
  if (asset.fileName) return asset.fileName;
  const fromUri = asset.uri.split('/').pop()?.split('?')[0];
  if (fromUri && /\.[a-z0-9]+$/i.test(fromUri)) return fromUri;
  const ext = EXT_BY_MIME[asset.mimeType ?? ''] ?? 'jpg';
  return `image-${index}.${ext}`;
}

/** 从相册多选图片（最多 limit 张，封顶 MAX_ATTACHMENTS）。返回本地资源（尚未上传）；用户取消返回 []。 */
export async function pickImages(limit: number): Promise<PickedImage[]> {
  const n = Math.max(1, Math.min(limit, MAX_ATTACHMENTS));
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: n,
    quality: 0.7, // 适度压缩，尽量落在 2MB 内
    exif: false,
  });
  if (res.canceled || !res.assets?.length) return [];
  return res.assets.slice(0, n).map((a, i) => ({
    uri: a.uri,
    name: fileNameFor(a, i),
    mimeType: a.mimeType ?? 'image/jpeg',
    size: a.fileSize,
    width: a.width,
  }));
}

/** 选择一个本地 zip 文件。并发调用会复用同一次系统选择，用户取消返回 null。 */
export function pickZipFile(): Promise<PickedFile | null> {
  if (pendingZipPick) return pendingZipPick;

  pendingZipPick = (async () => {
    let res;
    try {
      res = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
        multiple: false,
        copyToCacheDirectory: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/document picking in progress/i.test(message)) {
        throw new Error('文件选择器状态异常，请重新打开 App 后重试');
      }
      throw error;
    }
    if (res.canceled || !res.assets?.length) return null;

    const asset = res.assets[0];
    const name = asset.name || asset.uri.split('/').pop()?.split('?')[0] || 'project.zip';
    if (!name.toLowerCase().endsWith('.zip')) throw new Error('请选择 .zip 文件');

    const size = typeof asset.size === 'number' && asset.size > 0 ? asset.size : await fileSizeOf(asset.uri);
    if (size <= 0) throw new Error('无法读取 zip 文件大小，请重新选择');
    if (size > MAX_ZIP_BYTES) throw new Error('zip 文件不能超过 10MB');

    return {
      uri: asset.uri,
      name,
      mimeType: asset.mimeType ?? 'application/zip',
      size,
    };
  })().finally(() => {
    pendingZipPick = null;
  });

  return pendingZipPick;
}

function pickedFileName(name: string | undefined, uri: string): string {
  const candidate = (name || uri.split('/').pop()?.split('?')[0] || 'upload').replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  const cleaned = candidate.replace(/[\u0000-\u001f\u007f]/g, '');
  return !cleaned || cleaned === '.' || cleaned === '..' ? 'upload' : cleaned;
}

/** 从系统文件选择器选择一个要写入任务工作区的文件；用户取消返回 null。 */
export function pickWorkspaceFile(): Promise<PickedFile | null> {
  if (pendingWorkspaceFilePick) return pendingWorkspaceFilePick;

  pendingWorkspaceFilePick = (async () => {
    let res;
    try {
      res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/document picking in progress/i.test(message)) {
        throw new Error('文件选择器状态异常，请重新打开 App 后重试');
      }
      throw error;
    }
    if (res.canceled || !res.assets?.length) return null;

    const asset = res.assets[0];
    let size = typeof asset.size === 'number' && asset.size >= 0 ? asset.size : undefined;
    if (size === undefined) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri);
        if (info.exists && typeof (info as { size?: number }).size === 'number') size = (info as { size: number }).size;
      } catch { /* 下面统一报错 */ }
    }
    if (size === undefined || size < 0) throw new Error('无法读取文件大小，请重新选择');
    if (size > MAX_WORKSPACE_FILE_BYTES) throw new Error('单个文件不能超过 10MB');

    return {
      uri: asset.uri,
      name: pickedFileName(asset.name, asset.uri),
      mimeType: asset.mimeType ?? 'application/octet-stream',
      size,
    };
  })().finally(() => {
    pendingWorkspaceFilePick = null;
  });

  return pendingWorkspaceFilePick;
}

async function fileSizeOf(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof (info as { size?: number }).size === 'number' ? (info as { size: number }).size : 0;
  } catch {
    return 0;
  }
}

/** 压到 ≤2MB：逐步缩边长 + JPEG 压缩，取第一个达标的（已比目标更窄就只压缩、不放大）；最坏取最小那次。 */
async function compressUnderLimit(img: PickedImage): Promise<string> {
  const ow = typeof img.width === 'number' ? img.width : 0;
  const steps: { w: number; c: number }[] = [
    { w: 2048, c: 0.7 },
    { w: 1600, c: 0.7 },
    { w: 1280, c: 0.6 },
    { w: 1024, c: 0.55 },
    { w: 800, c: 0.45 },
  ];
  let best: { uri: string; size: number } | null = null;
  for (const s of steps) {
    const res = await ImageManipulator.manipulateAsync(
      img.uri,
      ow && ow <= s.w ? [] : [{ resize: { width: s.w } }],
      { compress: s.c, format: ImageManipulator.SaveFormat.JPEG },
    );
    const size = await fileSizeOf(res.uri);
    if (size > 0 && size <= MAX_IMAGE_BYTES) return res.uri;
    if (!best || (size > 0 && size < best.size)) best = { uri: res.uri, size };
  }
  return best?.uri ?? img.uri;
}

/** 保证 ≤2MB：原图已达标直接用；超限（或大小未知）则压缩，并把文件名改成 .jpg（压缩输出为 JPEG）。 */
async function ensureUnderLimit(img: PickedImage): Promise<{ uri: string; name: string }> {
  if (typeof img.size === 'number' && img.size > 0 && img.size <= MAX_IMAGE_BYTES) {
    return { uri: img.uri, name: img.name };
  }
  const uri = await compressUnderLimit(img);
  const base = img.name.replace(/\.[^.]+$/, '') || 'image';
  return { uri, name: `${base}.jpg` };
}

/** 读取本地文件为 ArrayBuffer；RN 网络层发送 ArrayBuffer 时不会自动添加 Content-Type。 */
function readLocalArrayBuffer(uri: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.response instanceof ArrayBuffer) resolve(xhr.response);
      else reject(new Error('读取本地文件失败'));
    };
    xhr.onerror = () => reject(new Error('读取本地文件失败'));
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/** 本地文件：预签名 -> PUT 原始字节 -> 返回可访问 URL + 文件名。 */
export async function uploadFileWithPresignedUrl(file: PickedFile): Promise<UploadedAttachment> {
  let resp;
  try {
    resp = await request<{ access_url?: string; upload_url?: string }>(
      '/api/v1/uploader/presign',
      { method: 'POST', body: { filename: file.name } },
    );
  } catch (e) {
    throw new Error(`获取上传地址失败（${e instanceof Error ? e.message : '未知'}）`);
  }
  const uploadUrl = resp.data?.upload_url;
  const accessUrl = resp.data?.access_url;
  if (!uploadUrl || !accessUrl) throw new Error('获取上传地址失败：响应缺少 URL');

  let status: number;
  let responseBody = '';
  if (Platform.OS === 'android') {
    // Android 的 fetch(ArrayBuffer) 要求 Content-Type；原生二进制上传允许完全省略该 header。
    const put = await FileSystem.uploadAsync(uploadUrl, file.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    });
    status = put.status;
    responseBody = put.body ?? '';
  } else {
    // iOS 的 URLSession 文件上传会自动补 application/octet-stream，导致 OSS V1 签名不匹配。
    // ArrayBuffer 请求不会补 Content-Type，与预签名时的请求头保持一致。
    const body = await readLocalArrayBuffer(file.uri);
    const put = await fetch(uploadUrl, { method: 'PUT', body, credentials: 'omit' });
    status = put.status;
    if (!put.ok) responseBody = await put.text().catch(() => '');
  }
  if (status < 200 || status >= 300) {
    const code = responseBody.match(/<Code>([^<]*)<\/Code>/)?.[1] ?? '';
    const message = responseBody.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? '';
    throw new Error(`上传失败（${status}${code ? ` ${code}` : ''}${message ? `：${message}` : ''}）`);
  }
  return { url: accessUrl, filename: file.name };
}

/** 把本地文件以 multipart/form-data 直接写入任务 VM 的绝对路径。 */
export async function uploadWorkspaceFile(vmId: string, path: string, file: PickedFile, signal?: AbortSignal): Promise<void> {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || 'application/octet-stream',
  } as unknown as Blob);
  await request('/api/v1/users/files/upload', {
    method: 'POST',
    query: { id: vmId, path },
    formData,
    signal,
  });
}

/** 单张图片：必要时压到 ≤2MB -> 预签名 -> PUT 原始字节 -> 返回可访问 URL + 文件名。 */
export async function uploadImage(img: PickedImage): Promise<UploadedAttachment> {
  const { uri, name } = await ensureUnderLimit(img);
  return uploadFileWithPresignedUrl({ uri, name, mimeType: 'image/jpeg' });
}

async function downloadToCache(url: string): Promise<string> {
  const last = url.split('/').pop()?.split('?')[0] || 'image';
  const safe = last.replace(/[^\w.\-]/g, '_');
  const name = /\.[a-z0-9]+$/i.test(safe) ? safe : `${safe}.jpg`;
  const target = `${FileSystem.cacheDirectory ?? ''}save-${name}`;
  const dl = await FileSystem.downloadAsync(url, target);
  if (dl.status < 200 || dl.status >= 300) throw new Error(`下载失败（${dl.status}）`);
  return dl.uri;
}

/** 把对话里的图片下载后存进系统相册（expo-media-library）。需原生构建里编入了该模块。 */
export async function saveImageToAlbum(url: string): Promise<void> {
  if (!url) throw new Error('图片地址为空');
  let granted: boolean;
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true); // writeOnly：仅请求「添加到相册」
    granted = !!perm.granted;
  } catch {
    // 当前运行的包没编入 expo-media-library 原生模块（直接调用会抛 undefined is not a function）
    throw new Error('保存到相册需重新构建 App 后生效');
  }
  if (!granted) throw new Error('未授予相册权限，请在系统设置中允许访问照片');
  const localUri = await downloadToCache(url);
  await MediaLibrary.saveToLibraryAsync(localUri);
}
