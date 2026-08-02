// 对话流:思考块、轮次边界、模型切换、用户气泡与逐项分发(相邻工具卡共享外框)。
import { useState, type ReactElement } from "react";
import { isImageFilename } from "./cloudUpload";
import { openExternal } from "./host";
import { IconChevronRight, IconSpark } from "./icons";
import { Markdown, MarkdownInline } from "./markdown";
import { AskCard, PermCard } from "./promptCards";
import { permAnchors } from "./reduce";
import { ToolCard } from "./toolCard";
import type { CloudAttachment, Frame, LogItem } from "./types";
import { UploadImg, downloadUpload } from "./uploadMedia";

/** 引擎思考流按 chunk 裸拼,相邻加粗标题会连成 `**A****B**`;marked 把中间的
 * `****` 当字面量吞进同一个 strong,先补成段落边界再交给 markdown。 */
function thoughtMarkdown(text: string): string {
  return text.replace(/\*{4}/g, "**\n\n**");
}

/** 思考块:单行折叠(✦ 思考 + 摘要省略),点击在下方展开完整文本的缩进块。
 * 全文不放进标题 flex 行:多行文本会把居中的图标顶到段落中部,标签与内容挤作一团。 */
function ThoughtView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const md = thoughtMarkdown(text);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "var(--t4)",
          cursor: "pointer",
          userSelect: "none",
          lineHeight: 1.6,
          minWidth: 0,
        }}
      >
        <IconSpark />
        <span style={{ fontWeight: 600, color: "var(--t3)", flex: "none" }}>思考</span>
        {!open && <MarkdownInline text={md.trim().replace(/\s+/g, " ")} style={{ flex: 1, minWidth: 0 }} />}
        {open && <span style={{ flex: 1 }} />}
        <IconChevronRight
          size={9}
          color="var(--t6)"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
        />
      </div>
      {open && (
        <div
          className="selectable thought-md"
          style={{
            marginLeft: 5,
            borderLeft: "2px solid var(--line)",
            padding: "2px 0 2px 13px",
            wordBreak: "break-word",
            animation: "mcin .2s ease",
          }}
        >
          <Markdown text={md} />
        </div>
      )}
    </div>
  );
}

/** 轮次边界只保留呼吸间距；消息天然按用户/助手交替，不再用横线切碎正文。 */
function TurnDivider() {
  return <div aria-label="本轮结束" style={{ height: 2 }} />;
}

/** 连续模型切换属于一件系统事件，折成一条路径，避免多行居中文字占满对话。 */
function ModelSwitchEvent({ names }: { names: string[] }) {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <span style={{ maxWidth: "90%", padding: "3px 9px", borderRadius: 999, background: "var(--codeBg)", color: "var(--t5)", fontSize: 10.5 }}>
        模型 · {names.join(" → ")}
      </span>
    </div>
  );
}

/** 用户消息里的附件行:`[图片]/[文件] <工作区相对路径>`(composer 发送时拼接的约定格式)。
 * 提问大纲复用同一约定剥附件行,故导出。 */
export const ATT_LINE = /^\[(图片|文件)\] (\S+)$/;

/** 消息时间:默认隐藏,悬停消息时在其上沿浮出,不参与正文布局。 */
function MessageTime({ timestamp, align }: { timestamp?: number; align: "start" | "end" }) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  // 用户消息有气泡边框，需要比无底色的 assistant 正文再抬高一点，
  // 否则同一偏移会让时间胶囊压在气泡上沿。
  const top = align === "end" ? -20 : -16;
  return (
    <time
      className="mc-message-time"
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      style={{ position: "absolute", top, ...(align === "end" ? { right: 0 } : { left: 0 }) }}
    >
      {time}
    </time>
  );
}

/** 用户气泡:文本 + 附图缩略图(点击看大图)+ 文件 chip(点击下载)。
 * 附件两个来源互斥:本地会话走正文附件行约定(uploadUrl 回读工作区),
 * 云端任务走 attachments 字段(对象存储直链,CSP 已放行 https: 图源)。 */
function UserBubble({
  text,
  timestamp,
  seq,
  uploadUrl,
  attachments,
}: {
  text: string;
  timestamp?: number;
  /** 产生它的 user-input 帧 seq:提问大纲按它定位这条气泡 */
  seq?: number;
  uploadUrl?: (path: string) => Promise<string>;
  /** 云端任务附件(url 直链渲染;文件 chip 点击在浏览器打开) */
  attachments?: CloudAttachment[];
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  // 云端图片大图预览(直链,与本地 zoom 的回读语义不同,分开持有)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const lines = text.split("\n");
  const images: string[] = [];
  const files: string[] = [];
  const rest: string[] = [];
  for (const line of lines) {
    const m = line.match(ATT_LINE);
    if (m && uploadUrl) (m[1] === "图片" ? images : files).push(m[2]);
    else rest.push(line);
  }
  const body = rest.join("\n").trim();
  const cloudImages = (attachments ?? []).filter((a) => isImageFilename(a.filename));
  const cloudFiles = (attachments ?? []).filter((a) => !isImageFilename(a.filename));
  return (
    <div data-mc-seq={seq} style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        className="mc-message-row"
        style={{
          position: "relative",
          maxWidth: "72%",
          background: "var(--userBg)",
          border: "1px solid var(--accBd)",
          borderRadius: "14px 14px 4px 14px",
          padding: "10px 15px",
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "var(--t1)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          animation: "mcin .25s ease",
        }}
      >
        {body}
        {(images.length > 0 || files.length > 0 || cloudImages.length > 0 || cloudFiles.length > 0) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: body ? 8 : 2, alignItems: "center" }}>
            {cloudImages.map((a) => (
              <img
                key={a.url}
                src={a.url}
                alt={a.filename}
                title={a.filename}
                onClick={() => setZoomUrl(a.url)}
                style={{
                  maxWidth: 150,
                  maxHeight: 120,
                  borderRadius: 8,
                  border: "1px solid var(--accBd)",
                  cursor: "zoom-in",
                  display: "block",
                }}
              />
            ))}
            {cloudFiles.map((a) => (
              <span
                key={a.url}
                title={a.filename + "(点击在浏览器打开)"}
                onClick={() => openExternal(a.url)}
                style={{
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: "1px solid var(--accBd)",
                  background: "var(--card)",
                  fontSize: 12,
                  color: "var(--t2)",
                  maxWidth: 240,
                  cursor: "pointer",
                }}
              >
                📄
                <span className="ellipsis">{a.filename}</span>
              </span>
            ))}
            {images.map((p) => (
              <UploadImg
                key={p}
                load={() => uploadUrl!(p)}
                alt={p}
                title={p}
                onClick={() => setZoom(p)}
                style={{
                  maxWidth: 150,
                  maxHeight: 120,
                  borderRadius: 8,
                  border: "1px solid var(--accBd)",
                  cursor: "zoom-in",
                  display: "block",
                }}
              />
            ))}
            {files.map((p) => (
              <span
                key={p}
                title={p + "(点击下载)"}
                onClick={() => downloadUpload(() => uploadUrl!(p), p.split("/").pop() || "附件")}
                style={{
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: "1px solid var(--accBd)",
                  background: "var(--card)",
                  fontSize: 12,
                  color: "var(--t2)",
                  maxWidth: 240,
                  cursor: "pointer",
                }}
              >
                📄
                <span className="ellipsis">
                  {p.split("/").pop()}
                </span>
              </span>
            ))}
          </div>
        )}
        <MessageTime timestamp={timestamp} align="end" />
      </div>
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim3)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <UploadImg
            load={() => uploadUrl!(zoom)}
            alt={zoom}
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 10, boxShadow: "var(--shadowLg)" }}
          />
        </div>
      )}
      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim3)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={zoomUrl}
            alt=""
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 10, boxShadow: "var(--shadowLg)" }}
          />
        </div>
      )}
    </div>
  );
}

function ItemView({
  item,
  onPermAnswer,
  onAskAnswer,
  uploadUrl,
  onLocalLink,
}: {
  item: Exclude<LogItem, { kind: "tool" }>;
  onPermAnswer: (id: string, action: "allow" | "always" | "persist" | "deny") => void;
  onAskAnswer?: (askId: string, answers: Record<string, string | string[]>) => void;
  uploadUrl?: (path: string) => Promise<string>;
  onLocalLink?: (path: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <UserBubble
          text={item.text}
          timestamp={item.timestamp}
          seq={item.seq}
          uploadUrl={uploadUrl}
          attachments={item.attachments}
        />
      );
    // 模型侧产出(正文/思考/工具卡)一律占满内容轨,不再自缩 92%:轨宽已由
    // COL_MAX 的 920 封顶管住行长,再缩一次只会让带边框的工具卡比 composer
    // 右缘短一截(宽屏约 69px),看着像没对齐;左右泳道由气泡的底色/描边/右对齐
    // 区分,不靠这点留白。省下的宽度给代码块与表格(二者均 overflow-x: auto)。
    case "agent":
      return (
        <div
          className="mc-message-row"
          style={{ position: "relative", wordBreak: "break-word", animation: "mcin .25s ease" }}
        >
          <Markdown text={item.text} localImageUrl={uploadUrl} onLocalLink={onLocalLink} />
          <MessageTime timestamp={item.timestamp} align="start" />
        </div>
      );
    case "thought":
      return <ThoughtView text={item.text} />;
    case "sys":
      if (item.text === "— 本轮结束 —") return <TurnDivider />;
      return (
        <div className="selectable" style={{ color: item.error ? "var(--err)" : "var(--t5)", fontSize: 11.5, textAlign: "center" }}>
          {item.text}
        </div>
      );
    case "perm":
      return <PermCard item={item} onAnswer={onPermAnswer} />;
    case "ask":
      return <AskCard item={item} onAnswer={onAskAnswer} />;
  }
}

/** 对话流:相邻工具调用共享一个卡片外框，以细分割线保留逐项结构。 */
export function LogList({
  items,
  keyBase = 0,
  onPermAnswer,
  onAskAnswer,
  onOpenChild,
  uploadUrl,
  onLocalLink,
  workdir,
  loadFullTool,
}: {
  items: LogItem[];
  /** 渲染 key 的基准(见 ChatState.keyBase):「加载更早」前插 N 条时它减 N,
   * 既有条目的 key 保持不变——否则整列重挂载、展开态串位、markdown 全部重解析 */
  keyBase?: number;
  onPermAnswer: (id: string, action: "allow" | "always" | "persist" | "deny") => void;
  /** 回答 AI 提问卡(云端任务);缺省则提问卡只读 */
  onAskAnswer?: (askId: string, answers: Record<string, string | string[]>) => void;
  onOpenChild?: (id: string) => void;
  /** 已上传附件/工作区图片路径 → 可渲染 URL(不传则本地图片不加载) */
  uploadUrl?: (path: string) => Promise<string>;
  /** Markdown 中工作区文件链接的安全打开动作 */
  onLocalLink?: (path: string) => void;
  /** 工作区根:工具卡标题里的绝对路径按它收敛为相对路径 */
  workdir?: string;
  /** 回读被截断的工具大字段原文(见 fold.rs 的大字段护栏) */
  loadFullTool?: (seq: number) => Promise<Frame>;
}) {
  // 审批锚定:待决 perm 带 toolCallId 且有同 id 工具卡时,按钮行嵌进
  // 那张卡(见 reduce.ts::permAnchors),对应的独立审批项跳过不渲染;
  // 无锚点(旧引擎/云端任务流/找不到卡)仍走独立 PermCard,行为不变
  const anchors = permAnchors(items);
  const anchored = new Set(anchors.values());
  const out: ReactElement[] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    const modelName = it.kind === "sys" && !it.error ? it.text.match(/^模型已切换为\s*(.+)$/)?.[1] : undefined;
    if (modelName) {
      const start = i;
      const names: string[] = [];
      while (i < items.length) {
        const next = items[i];
        const name = next.kind === "sys" && !next.error ? next.text.match(/^模型已切换为\s*(.+)$/)?.[1] : undefined;
        if (!name) break;
        names.push(name);
        i++;
      }
      out.push(<ModelSwitchEvent key={"models" + (keyBase + start)} names={names} />);
    } else if (it.kind === "tool") {
      const start = i;
      const group: Extract<LogItem, { kind: "tool" }>[] = [];
      while (i < items.length) {
        const t = items[i];
        if (t.kind !== "tool") break;
        group.push(t);
        i++;
      }
      const grouped = group.length > 1;
      out.push(
        <div className={grouped ? "card tool-stack" : undefined} key={"g" + (keyBase + start)} style={{ display: "flex", flexDirection: "column", gap: grouped ? 0 : 8 }}>
          {group.map((t, j) => (
            <ToolCard
              key={t.tcId || j}
              item={t}
              onOpenChild={onOpenChild}
              uploadUrl={uploadUrl}
              onLocalLink={onLocalLink}
              workdir={workdir}
              perm={anchors.get(t.tcId)}
              onPermAnswer={onPermAnswer}
              loadFullTool={loadFullTool}
              grouped={grouped}
            />
          ))}
        </div>,
      );
    } else {
      if (it.kind === "perm" && anchored.has(it)) {
        i++; // 已嵌进工具卡,独立卡不渲染
        continue;
      }
      out.push(
        <ItemView
          key={keyBase + i}
          item={it}
          onPermAnswer={onPermAnswer}
          onAskAnswer={onAskAnswer}
          uploadUrl={uploadUrl}
          onLocalLink={onLocalLink}
        />,
      );
      i++;
    }
  }
  return <>{out}</>;
}
