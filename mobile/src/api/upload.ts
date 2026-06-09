/**
 * 图片附件：选图 + 上传。对齐 Web 端 chat-inputbox 的「预签名直传」流程：
 *   1) POST /api/v1/uploader/presign { filename } -> { access_url, upload_url }
 *   2) PUT 原始字节到 upload_url（预签名 URL 自带鉴权，不需要 cookie）
 *   3) 发消息时带上 { url: access_url, filename }
 * 约束与 Web 对齐：单张 ≤2MB、最多 3 张、仅图片。
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { request } from './client';

export const MAX_ATTACHMENTS = 3;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB（与 Web MAX_UPLOAD_FILE_SIZE 一致）

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

/**
 * 把本地文件读成 RN 原生 Blob（文件背书，不进 JS 内存）。
 * 不能用 `fetch(uri).blob()` —— RN 不支持从 arraybuffer 造 Blob（报 "create blob from arraybuffer is not supported"）。
 * XHR + responseType='blob' 是 RN 里从本地文件拿 Blob 的可靠做法。
 */
function readLocalBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error('读取本地图片失败'));
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/** 单张图片：必要时压到 ≤2MB -> 预签名 -> PUT 原始字节 -> 返回可访问 URL + 文件名。 */
export async function uploadImage(img: PickedImage): Promise<UploadedAttachment> {
  const { uri, name } = await ensureUnderLimit(img);
  // 第一步：取预签名 URL（cookie 鉴权的 API）。失败前缀「获取上传地址失败」以便和 PUT 区分。
  let resp;
  try {
    resp = await request<{ access_url?: string; upload_url?: string }>(
      '/api/v1/uploader/presign',
      { method: 'POST', body: { filename: name } },
    );
  } catch (e) {
    throw new Error(`获取上传地址失败（${e instanceof Error ? e.message : '未知'}）`);
  }
  const uploadUrl = resp.data?.upload_url;
  const accessUrl = resp.data?.access_url;
  if (!uploadUrl || !accessUrl) throw new Error('获取上传地址失败：响应缺少 URL');

  // 第二步：原始字节直传预签名 URL。credentials:'omit' 跨域不带会话 Cookie（对齐 Web）。
  // slice(...,'') 去掉 blob 的 content-type → PUT 不带 Content-Type 头（等价于 Web 的 new Blob([file])），
  // 避免 iOS 多发的 Content-Type 改变 SigV4 规范请求导致 SignatureDoesNotMatch。
  const srcBlob = await readLocalBlob(uri);
  const body = srcBlob.slice(0, srcBlob.size, '');
  try {
    const put = await fetch(uploadUrl, { method: 'PUT', body, credentials: 'omit' });
    if (!put.ok) {
      let code = '';
      try { code = (await put.text()).match(/<Code>([^<]*)<\/Code>/)?.[1] ?? ''; } catch { /* ignore */ }
      throw new Error(`上传失败（${put.status}${code ? ' ' + code : ''}）`);
    }
  } finally {
    (srcBlob as Blob & { close?: () => void }).close?.(); // 释放 RN 原生 blob
  }
  return { url: accessUrl, filename: name };
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
