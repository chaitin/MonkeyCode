// 本地附件行约定(跨层线格式,非 i18n 文案):composer 发送时把
// 「[图片]/[文件] <工作区相对路径>」并入正文,壳/引擎当纯文本转发;
// 渲染侧(用户气泡剥离还原缩略图/文件 chip、大纲摘要剥行)按同一正则识别。
// 本模块是唯一出处——此前正则散在 OutlineNav 与 useComposer 两处。
export const ATT_LINE = /^\[(图片|文件)\] (\S+)$/;

/** composer 侧拼接(与旧 UI ATT_LINE 同口径)。 */
export function attLineOf(path: string, isImage: boolean): string {
  return `${isImage ? "[图片]" : "[文件]"} ${path}`;
}

export interface SplitAttachments {
  /** 剥掉附件行后的正文(首尾空白裁掉)。 */
  body: string;
  /** 附件行里的图片路径(工作区相对)。 */
  images: string[];
  /** 附件行里的文件路径。 */
  files: string[];
}

/** 正文与附件行分离(旧 UI logView 同款):附件行进 images/files,其余原样合回。 */
export function splitAttachments(text: string): SplitAttachments {
  const images: string[] = [];
  const files: string[] = [];
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(ATT_LINE);
    if (m) (m[1] === "图片" ? images : files).push(m[2]!);
    else rest.push(line);
  }
  return { body: rest.join("\n").trim(), images, files };
}
