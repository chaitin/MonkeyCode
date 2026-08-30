// 本地附件行约定(跨层线格式,非 i18n 文案):composer 发送时把
// 「[图片]/[文件] <工作区相对路径>」并入正文,壳/引擎当纯文本转发;
// 渲染侧(用户气泡剥离还原缩略图/文件 chip、大纲摘要剥行)按同一正则识别。
// 本模块是唯一出处——此前正则散在 OutlineNav 与 useComposer 两处。
export const ATT_LINE = /^\[(图片|文件)\] (\S+)$/;

// 「[目录] <绝对路径>」是引用而非上传:壳不拷贝内容,只把路径交给 agent 自取。
// 与上两种分开是因为两点不同——路径由用户在系统对话框里选,可能含空格(故用
// `.+` 而非 `\S+`);且它是 resolveRuntimePath 后的**运行时绝对路径**,不是
// 工作区相对路径,渲染侧不能拿去 uploadUrl 回读。
export const DIR_LINE = /^\[目录\] (.+)$/;

/** composer 侧拼接(与旧 UI ATT_LINE 同口径)。 */
export function attLineOf(path: string, isImage: boolean): string {
  return `${isImage ? "[图片]" : "[文件]"} ${path}`;
}

/** 目录引用行(路径原样,不做工作区相对化)。 */
export function dirLineOf(path: string): string {
  return `[目录] ${path}`;
}

/** 附件对象 → 行。三种附件的分流只在这里判一次(composer 草稿、发送队列、
 *  stash 恢复共用),避免各处再各写一遍 isDir 判断。 */
export function attLineFor(a: { path: string; isImage: boolean; isDir?: boolean }): string {
  return a.isDir ? dirLineOf(a.path) : attLineOf(a.path, a.isImage);
}

export interface SplitAttachments {
  /** 剥掉附件行后的正文(首尾空白裁掉)。 */
  body: string;
  /** 附件行里的图片路径(工作区相对)。 */
  images: string[];
  /** 附件行里的文件路径。 */
  files: string[];
  /** 目录引用行里的绝对路径(仅展示,不可回读)。 */
  dirs: string[];
}

/** 正文与附件行分离(旧 UI logView 同款):附件行进 images/files/dirs,其余原样合回。 */
export function splitAttachments(text: string): SplitAttachments {
  const images: string[] = [];
  const files: string[] = [];
  const dirs: string[] = [];
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(ATT_LINE);
    if (m) {
      (m[1] === "图片" ? images : files).push(m[2]!);
      continue;
    }
    const d = line.match(DIR_LINE);
    if (d) dirs.push(d[1]!);
    else rest.push(line);
  }
  return { body: rest.join("\n").trim(), images, files, dirs };
}
