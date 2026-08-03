// 文件类型图标:文件名 → tabler 图标 + 色调。文件树/改动列表/云端文件页
// 共用一份(三处此前要么清一色灰 File、要么根本没图标,用户报障
// 2026-08-06「太丑」)。
//
// 颜色纪律(LAYOUT §8):一律用 daisyUI 语义色类,跟主题变量走——35 个
// 主题(含深色/高对比)下都协调;硬编码 hex 色板只在浅色主题上好看。
// 类名必须是完整字面量:Tailwind 静态扫描源码文本,拼接出来的类不生成。
// 语义色在这里表达的是「文件族类」不是状态——状态另有行尾徽标承担,
// 两者一个在行首一个在行尾,不抢读。
//
// ⚠️ 选图标先确认**它是不是字形**:tabler 里有一批是文字标记(IconJson 画的
// 就是「JSON」四个字母),20px 的图集里看着挺清楚,落到文件树的 12px 上糊成
// 一团。数据文件因此取 IconBraces(花括号)而非 IconJson——2026-08-07 换库时
// 按真实尺寸离屏出图才发现,只翻图集不出图会漏掉这类。
import { IconDatabase, IconFile, IconFileCertificate, IconFileCode, IconFileMusic, IconFileSettings, IconFileSpreadsheet, IconFileText, IconFileTypography, IconFileZip, IconBraces, IconMovie, IconPhoto, IconScript, type TablerIcon } from "@tabler/icons-react";

export interface FileIconSpec {
  icon: TablerIcon;
  /** 完整的 Tailwind 颜色类字面量(禁拼接) */
  tone: string;
}

const CODE: FileIconSpec = { icon: IconFileCode, tone: "text-info" };
const MARKUP: FileIconSpec = { icon: IconFileCode, tone: "text-warning" };
const STYLE: FileIconSpec = { icon: IconFileCode, tone: "text-secondary" };
const DATA: FileIconSpec = { icon: IconBraces, tone: "text-warning" };
const CONF: FileIconSpec = { icon: IconFileSettings, tone: "text-base-content/45" };
const DOC: FileIconSpec = { icon: IconFileText, tone: "text-base-content/50" };
const IMAGE: FileIconSpec = { icon: IconPhoto, tone: "text-accent" };
const VIDEO: FileIconSpec = { icon: IconMovie, tone: "text-accent" };
const AUDIO: FileIconSpec = { icon: IconFileMusic, tone: "text-accent" };
const ARCHIVE: FileIconSpec = { icon: IconFileZip, tone: "text-base-content/45" };
const SHELL: FileIconSpec = { icon: IconScript, tone: "text-success" };
const SHEET: FileIconSpec = { icon: IconFileSpreadsheet, tone: "text-success" };
const DB: FileIconSpec = { icon: IconDatabase, tone: "text-info" };
const LOCK: FileIconSpec = { icon: IconFileCertificate, tone: "text-base-content/35" };
const FONT: FileIconSpec = { icon: IconFileTypography, tone: "text-base-content/45" };
const PLAIN: FileIconSpec = { icon: IconFile, tone: "text-base-content/40" };

const BY_EXT: Record<string, FileIconSpec> = {
  // 代码
  ts: CODE, tsx: CODE, js: CODE, jsx: CODE, mjs: CODE, cjs: CODE,
  rs: CODE, go: CODE, py: CODE, rb: CODE, java: CODE, kt: CODE, swift: CODE,
  c: CODE, h: CODE, cc: CODE, cpp: CODE, hpp: CODE, cs: CODE, php: CODE,
  lua: CODE, dart: CODE, scala: CODE, ex: CODE, exs: CODE, zig: CODE,
  // 标记 / 模板
  html: MARKUP, htm: MARKUP, xml: MARKUP, vue: MARKUP, svelte: MARKUP, astro: MARKUP,
  // 样式
  css: STYLE, scss: STYLE, sass: STYLE, less: STYLE, styl: STYLE,
  // 结构化数据
  json: DATA, jsonc: DATA, json5: DATA,
  // 配置
  yaml: CONF, yml: CONF, toml: CONF, ini: CONF, conf: CONF, cfg: CONF, env: CONF, properties: CONF,
  // 文档
  md: DOC, mdx: DOC, txt: DOC, rst: DOC, adoc: DOC, pdf: DOC, doc: DOC, docx: DOC,
  // 媒体
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, svg: IMAGE, ico: IMAGE, bmp: IMAGE, avif: IMAGE,
  mp4: VIDEO, mov: VIDEO, webm: VIDEO, mkv: VIDEO, avi: VIDEO,
  mp3: AUDIO, wav: AUDIO, flac: AUDIO, ogg: AUDIO, m4a: AUDIO,
  // 归档
  zip: ARCHIVE, tar: ARCHIVE, gz: ARCHIVE, tgz: ARCHIVE, bz2: ARCHIVE, xz: ARCHIVE, rar: ARCHIVE, "7z": ARCHIVE,
  // 脚本
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL, ps1: SHELL, bat: SHELL, cmd: SHELL,
  // 表格 / 数据库
  csv: SHEET, tsv: SHEET, xls: SHEET, xlsx: SHEET,
  sql: DB, db: DB, sqlite: DB, sqlite3: DB,
  // 字体
  ttf: FONT, otf: FONT, woff: FONT, woff2: FONT, eot: FONT,
};

/** 整名匹配(无扩展名或扩展名不表意的知名文件);键一律小写比对。 */
const BY_NAME: Record<string, FileIconSpec> = {
  dockerfile: CONF,
  makefile: CONF,
  procfile: CONF,
  ".gitignore": CONF,
  ".gitattributes": CONF,
  ".dockerignore": CONF,
  ".editorconfig": CONF,
  ".npmrc": CONF,
  ".nvmrc": CONF,
  "package-lock.json": LOCK,
  "pnpm-lock.yaml": LOCK,
  "yarn.lock": LOCK,
  "bun.lock": LOCK,
  "cargo.lock": LOCK,
  "poetry.lock": LOCK,
  "go.sum": LOCK,
  license: DOC,
  "license.md": DOC,
  readme: DOC,
};

/** 文件名 → 图标与色调。整名优先(package-lock.json 是锁文件不是 json),
 * 再看扩展名,都不认识回落中性 File。 */
export function fileIconOf(name: string): FileIconSpec {
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  const whole = BY_NAME[base];
  if (whole) return whole;
  const dot = base.lastIndexOf(".");
  // 前导点的隐藏文件(.gitignore)没在整名表里就当无扩展名,不把 "gitignore" 当扩展
  if (dot <= 0) return PLAIN;
  return BY_EXT[base.slice(dot + 1)] ?? PLAIN;
}
