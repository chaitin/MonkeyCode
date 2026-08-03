// 云端任务聊天附件上传管线(旧 UI cloudUpload.ts 随迁,约束对齐 web
// task-file-upload.tsx):单条消息最多 3 个附件、单文件 2MB;超过 200KB 的
// 可压缩位图先经 canvas 转 webp(质量 0.6)缩体积,压不动(变大/编码失败)
// 回退原图再按 2MB 拦截。实际上传经壳命令 mc_upload(presign + PUT 都在
// 壳内完成,凭证不出内核,也避开 WebView 直传对象存储的跨域限制);返回的
// access_url 放进 user-input 的 attachments(服务端契约 {url, filename},
// 上限 10 个、URL 前缀白名单)。
import { t } from "@/lib/i18n";
import { mcUpload } from "@/lib/ipc/cloudtasks";

export const MAX_CLOUD_ATTS = 3;
export const MAX_CLOUD_FILE_BYTES = 2 * 1024 * 1024;
const COMPRESS_THRESHOLD_BYTES = 200 * 1024;
const COMPRESS_QUALITY = 0.6;

/** 待发送的云端附件:上传已完成。preview 为图片的本地 dataURL 缩略
 * (发送时只取 url/filename,与 web/mobile 的 attachments 契约一致)。 */
export interface CloudUploadedAtt {
  url: string;
  filename: string;
  isImage: boolean;
  preview?: string;
}

/** 图片扩展名判定(对齐 web isTaskImageAttachment 的扩展名清单) */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
export const isImageFilename = (name: string) => IMAGE_EXT_RE.test(name);

/** 有损转 webp 收益可观的位图类型(gif 动图/svg 矢量转了会坏,不碰) */
const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/avif"]);

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

const HAS_EXT_RE = /\.[^./\\]+$/;

/** 剪贴板截图常无文件名/扩展名,而云端按扩展名识别类型:能从 MIME 推断的
 * 补齐扩展名(空名补时间戳名),推不出的原样返回交由调用方拦截。 */
export function normalizeUploadName(f: File): string {
  const name = (f.name || "").trim();
  if (name && HAS_EXT_RE.test(name)) return name;
  const ext = MIME_EXT[f.type];
  if (!ext) return name;
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${name || `pasted-image-${stamp}`}.${ext}`;
}

/** canvas 转 webp。返回 null = 放弃压缩(解码失败/WebView 不支持 webp 编码),
 * 调用方回退原图——压缩是省流量的优化,绝不能成为上传失败的理由。 */
async function compressImage(f: File, name: string): Promise<File | null> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", COMPRESS_QUALITY));
    // toBlob 对不支持的编码会落回 png 等类型:类型不对视同不支持,回退原图
    if (!blob || blob.type !== "image/webp") return null;
    return new File([blob], name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File → dataURL(base64 字节取逗号后段)。 */
function readDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error(t("cloud.attach.readFailed")));
    r.readAsDataURL(f);
  });
}

/** 单文件上传:校验(空文件/扩展名/大小)→ 必要时压缩 → base64 → 壳直传。
 * 失败抛 Error(已本地化,调用方外显)。 */
export async function uploadCloudFile(f: File): Promise<CloudUploadedAtt> {
  if (f.size === 0) throw new Error(t("cloud.attach.empty", { name: f.name || "?" }));
  let name = normalizeUploadName(f);
  if (!name || !HAS_EXT_RE.test(name)) {
    throw new Error(t("cloud.attach.noExt", { name: f.name || "?" }));
  }
  const compressible = COMPRESSIBLE_TYPES.has(f.type);
  if (f.size > MAX_CLOUD_FILE_BYTES && !compressible) {
    throw new Error(t("cloud.attach.tooLarge", { name }));
  }
  let file: File = f;
  if (compressible && f.size > COMPRESS_THRESHOLD_BYTES) {
    const c = await compressImage(f, name);
    if (c && c.size < f.size) {
      file = c;
      name = c.name;
    }
  }
  if (file.size > MAX_CLOUD_FILE_BYTES) throw new Error(t("cloud.attach.stillTooLarge", { name }));
  const dataURL = await readDataURL(file);
  const { access_url } = await mcUpload(name, dataURL.slice(dataURL.indexOf(",") + 1));
  const isImage = f.type.startsWith("image/") || isImageFilename(name);
  return { url: access_url, filename: name, isImage, ...(isImage ? { preview: dataURL } : {}) };
}
