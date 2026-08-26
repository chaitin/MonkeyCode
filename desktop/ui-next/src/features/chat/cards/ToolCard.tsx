// 工具卡:状态点 + 「动作 + 目标」标题(lib/tools 语义层)+ 耗时;详情
// 开关 = 标题行尾 chevron 图标钮(旧 UI 安静行设计:耗时/详情钮 hover 显影,
// 常驻占位只切透明度,§6.2 铁律),详情 = 单一面板(diff/patch 走专用视图,
// 其余单 pre,不再盒中盒);大字段凭 _meta.mcSrc.seq 按需回读原帧补全;
// 相邻工具卡由 LogList 计算 joinPrev/joinNext 塌陷边框共享外框(旧
// tool-stack 设计,DOM 仍与 items 一一对应不破结构契约);子代理进度窗、
// 「查看结果」兜底、失败外显、findings、内嵌审批同前。
import { IconChevronRight, IconHandStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Markdown, MarkdownInline } from "@/components/markdown/Markdown";
import { Lightbox, UploadImg } from "@/components/media/UploadImg";
import { ApplyPatchView } from "@/features/files/ApplyPatchView";
import { DiffView } from "@/features/files/DiffView";
import { DetailModal } from "../DetailModal";
import { useI18n } from "@/lib/i18n";
import type { FrameSender } from "@/lib/ipc/approvals";
import { isImagePath } from "@/lib/ipc/uploads";
import { frameData, toolResultText } from "@/lib/protocol/codec";
import type { AcpUpdate, Frame, PermItem, SubEntry, ToolItem } from "@/lib/protocol/types";
import { stripWorkdir } from "@/lib/tools/stripWorkdir";
import { toolDetailFor, type ToolDetail } from "@/lib/tools/toolDetails";
import { presentToolCall, toolDisplayName, type ToolTargetKind } from "@/lib/tools/toolLabels";
import { FindingsCard, findingsReportFor } from "./FindingsCard";
import { PermActions } from "./PermCard";
import { statusDot } from "./statusDot";

/** 进度滚动窗口:固定只展示最后几条,旧条目自然滚出。 */
const FEED_WINDOW = 5;

/** 只显示可靠的最终耗时;没有完整起止时间时宁可留空。 */
function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** 工具态 → 状态点(配色降调口径收口在 statusDot)。 */
function statusTone(status: "run" | "ok" | "fail"): string {
  return statusDot(status);
}

/** 目标文本:path 型截断目录段、保住末段文件名可见(旧 UI ToolTargetText
 * 布局);完整值始终放 title 悬停,不在数据层截断。 */
function ToolTargetText({
  target,
  fullTarget,
  kind,
}: {
  target: string;
  fullTarget?: string;
  kind: ToolTargetKind;
}) {
  if (kind !== "path") {
    return (
      <span title={fullTarget || target} className="min-w-0 flex-1 truncate font-mono text-base-content/60">
        {target}
      </span>
    );
  }
  const split = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
  const hasFilename = split >= 0 && split < target.length - 1;
  const directory = hasFilename ? target.slice(0, split + 1) : "";
  const filename = hasFilename ? target.slice(split + 1) : target;
  return (
    <span title={fullTarget || target} className="flex min-w-0 flex-1 font-mono whitespace-nowrap">
      {directory && <span className="min-w-3 truncate text-base-content/40">{directory}</span>}
      <span className="max-w-[70%] shrink-0 truncate text-base-content/60">{filename}</span>
    </span>
  );
}

/** 子代理进度行:工具步骤同样过 presentToolCall(动作 + 目标),文本行走
 * 行内 Markdown。 */
function FeedRow({ entry, workdir }: { entry: SubEntry; workdir?: string }) {
  const { locale } = useI18n();
  if (entry.kind === "text") {
    return <MarkdownInline source={entry.text} className="block min-w-0 truncate text-base-content/50" />;
  }
  const sub = presentToolCall(entry.title, entry.rawInput, locale);
  const target = sub.targetKind === "path" ? stripWorkdir(sub.target, workdir) : sub.target;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className={`status ${statusTone(entry.status)}`} />
      <span className="shrink-0 text-base-content/70" title={entry.title}>
        {sub.action}
      </span>
      {target && <ToolTargetText target={target} fullTarget={sub.target} kind={sub.targetKind} />}
    </span>
  );
}

/** 详情正文(单一面板内,容器管边框/底色/滚动,这里不再套盒):diff 复用
 * FilesDrawer 的 DiffView 行模型;patch 按文件分段;command 收进一个 pre(cwd 弱化行 +
 * `$ 命令` + 空行 + 输出);text/json 单 pre。旧 UI 详情即单容器设计。 */
const PRE_CLASS = "m-0 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere select-text";

function DetailBody({ detail }: { detail: ToolDetail }) {
  const { t } = useI18n();
  if (detail.kind === "patch") {
    return <ApplyPatchView text={detail.text} />;
  }
  if (detail.kind === "diff") {
    return <DiffView text={detail.text} />;
  }
  if (detail.kind === "command") {
    return (
      <pre className={PRE_CLASS}>
        {detail.cwd && <span className="block text-base-content/40">{detail.cwd}</span>}
        <span aria-hidden className="text-base-content/40 select-none">
          {"$ "}
        </span>
        {detail.command}
        {"\n\n"}
        {detail.output || <span className="text-base-content/40">{t("chat.tool.emptyOutput")}</span>}
      </pre>
    );
  }
  return <pre className={PRE_CLASS}>{detail.text}</pre>;
}

export function ToolCard({
  item,
  perm,
  sessionId,
  sendFrame,
  onOpenChild,
  uploadUrl,
  onLocalLink,
  workdir,
  loadFullTool,
  joinPrev,
  joinNext,
}: {
  item: ToolItem;
  /** 锚定到本卡的待决审批(permAnchors 判定):⏸ 顶掉状态点 + 底部内嵌
   * 按钮行,独立审批大卡随之不渲染;已决后调用方不再传入,卡片回归常态 */
  perm?: PermItem;
  sessionId: string;
  /** 内嵌审批行的上行管道注入(云端任务经 stream WS);缺省 = 本地 sender */
  sendFrame?: FrameSender;
  /** 子代理卡「查看子会话」入口(item.childSessionId 存在时渲染) */
  onOpenChild?: (id: string) => void;
  /** 工具产出图片的回读通道(截图/读图工具);缺省不渲染图片区 */
  uploadUrl?: (path: string) => Promise<string>;
  /** 子代理结果 Markdown 里工作区文件链接的安全打开动作 */
  onLocalLink?: (path: string) => void;
  /** 会话工作目录:path 型目标剥绝对前缀(悬停仍露完整路径) */
  workdir?: string;
  /** 回读被截断的工具大字段原帧(壳侧物化超限截断,凭 _meta.mcSrc.seq);
   * 不传则只展示行内的截断头部 */
  loadFullTool?: (seq: number) => Promise<Frame>;
  /** 相邻工具卡共享外框(旧 tool-stack):上邻是工具卡 → 顶角取直,自身
   * border-t 兼作组内分隔线;下邻是工具卡 → 底角取直 + 去 border-b。 */
  joinPrev?: boolean;
  joinNext?: boolean;
}) {
  const { t, locale } = useI18n();
  const [zoom, setZoom] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [agentDetailOpen, setAgentDetailOpen] = useState(false);
  // 大字段护栏的另一半:行内只有截断头部时,展开即按 seq 回读原帧补全。
  // 截断与回读必须成对存在——只截不读会把子代理的最终产出切掉半截。
  const srcSeq = (item._meta as { mcSrc?: { seq?: number } } | undefined)?.mcSrc?.seq;
  const [full, setFull] = useState<AcpUpdate | null>(null);
  const [fullErr, setFullErr] = useState("");
  const [loadingFull, setLoadingFull] = useState(false);
  const wantFull = detailOpen || agentDetailOpen;
  useEffect(() => {
    if (!wantFull || srcSeq === undefined || full || loadingFull || fullErr || !loadFullTool) return;
    setLoadingFull(true);
    loadFullTool(srcSeq)
      .then((f) => {
        const update = frameData<{ update?: AcpUpdate }>(f)?.update;
        if (update) setFull(update);
        else setFullErr(t("chat.tool.sourceGone"));
      })
      .catch((e: unknown) => setFullErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingFull(false));
  }, [wantFull, srcSeq, full, loadingFull, fullErr, loadFullTool, t]);

  const images = uploadUrl ? (item.images ?? []).filter(isImagePath) : [];
  const duration = formatDuration(item.durationMs);
  const feed = item.feed ?? [];
  // 子代理卡沿用「子会话/查看结果」;其余本地与云端工具统一走结构化详情
  const isAgentCard = !!(item.childSessionId || feed.length || item.background);
  const agentFinished = isAgentCard && item.status !== "run";
  const canOpenChild = !!(item.childSessionId && onOpenChild);
  // 后台派发卡的过程详情统一放进弹窗；普通前台 Agent 仍保留原来的尾窗。
  const visibleFeed = !item.background && item.status === "run" ? feed.slice(-FEED_WINDOW) : [];
  const feedBase = feed.length - visibleFeed.length;

  // 回读到全文后用全文渲染详情;没有护栏标记时 full 恒为 null,行为不变
  const shown = full
    ? {
        ...item,
        ...(full.rawInput !== undefined ? { rawInput: full.rawInput } : {}),
        ...(full.rawOutput !== undefined ? { rawOutput: full.rawOutput } : {}),
        ...(full.content !== undefined ? { content: full.content } : {}),
      }
    : item;
  // 动作取标题,目标优先取完整 rawInput;path 型剥 workdir 前缀,
  // 悬停 title 保留原始标题与完整目标。回读到全文后标题也随 shown 更新。
  const presentation = presentToolCall(shown.title, shown.rawInput, { locale, toolKind: shown.toolKind, meta: shown._meta });
  const fullTarget = presentation.target;
  const target = presentation.targetKind === "path" ? stripWorkdir(fullTarget, workdir) : fullTarget;
  const findings = findingsReportFor(shown);
  const detail = !isAgentCard && shown.status !== "run" ? toolDetailFor(shown) : null;
  const fullResult = full ? toolResultText(full.rawOutput, full.content) : "";
  // 极端情况下子会话入口缺失(云端只读流/旧 journal),保留按需展开兜底,
  // 但不默认把整段结果灌进卡片
  const agentResult = agentFinished ? (fullResult || item.result || "").trim() : "";
  const openAgentDetail = () => {
    if (canOpenChild) onOpenChild!(item.childSessionId!);
    else setAgentDetailOpen(true);
  };
  const hasAgentModal = item.background || (!!agentResult && !canOpenChild);
  return (
    <div
      className={`mc-workbench-material card card-border overflow-hidden ${joinPrev ? "rounded-t-none" : ""} ${joinNext ? "rounded-b-none border-b-0" : ""}`}
      data-tool-id={item.tcId}
    >
      {/* 普通工具的标题行仍是详情开关；子代理类卡片统一只通过右侧文字动作
          打开弹窗，避免同一组里出现“蓝色链接 / 灰色状态 + 箭头”两套语义。 */}
      <div
        className={`flex items-center gap-2 px-3 py-2 text-xs ${detail ? "cursor-pointer" : ""}`}
        onClick={detail ? () => setDetailOpen((v) => !v) : undefined}
      >
        {perm ? (
          <IconHandStop size={14} stroke={1.75} aria-hidden className="shrink-0 text-warning" />
        ) : (
          <span aria-hidden className={`status ${statusTone(item.status)}`} />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {/* 动作名不加粗(用户定案 2026-08-06):一屏几十行工具卡,行行半粗
              等于没有重点;层次靠目标文本的 base-content/60 灰阶拉开 */}
          <span className="shrink-0" title={item.title}>
            {presentation.action}
          </span>
          {target && <ToolTargetText target={target} fullTarget={fullTarget} kind={presentation.targetKind} />}
        </span>
        {/* 耗时悬停显影(group 在 LogList 的条目包裹层;消息时间在块上方,
            不进本行);⚠️ 不挂 focus-within——粘滞根因,见 MessageTime 头注 */}
        {duration && (
          <span className="shrink-0 font-mono text-base-content/40 tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
            {duration}
          </span>
        )}
        {item.childSessionId && onOpenChild && (
          <button
            type="button"
            className="link link-hover link-primary shrink-0 text-xs font-semibold"
            onClick={(e) => {
              e.stopPropagation();
              onOpenChild(item.childSessionId!);
            }}
          >
            {t("chat.tool.childSession")}
          </button>
        )}
        {agentResult && !canOpenChild && !item.background && (
          <button
            type="button"
            className="link link-hover shrink-0 text-xs font-semibold text-base-content/60"
            aria-haspopup="dialog"
            onClick={(e) => {
              e.stopPropagation();
              setAgentDetailOpen(true);
            }}
          >
            {t("chat.tool.showResult")}
          </button>
        )}
        {item.background && !canOpenChild && (
          <button
            type="button"
            aria-haspopup="dialog"
            className="link link-hover link-primary shrink-0 text-xs font-semibold"
            onClick={(e) => {
              e.stopPropagation();
              openAgentDetail();
            }}
          >
            {t("chat.tool.agentDetailOpen")}
          </button>
        )}
        {detail && (
          <button
            type="button"
            aria-label={detailOpen ? t("chat.tool.detailClose") : t("chat.tool.detailOpen")}
            aria-expanded={detailOpen}
            title={detailOpen ? t("chat.tool.detailClose") : t("chat.tool.detailOpen")}
            // 裸图标钮,**不能**套 btn-xs:daisyUI 的 .btn 有 height:var(--size),
            // btn-xs 是 --size-field*6 = 24px,把 12px 的 text-xs 行撑到 24px,
            // 整张卡比工具组摘要头/思考块(同为 px-3 py-2 的 16px 行)高出 8px
            // ——单条工具卡显著高过合并后的组头,就是这 8px(用户报障 2026-08-06)。
            // 行本身已是点击热区,这个钮只作键盘/无障碍开关兼指示,与组头、
            // 思考块的裸 chevron 同形态
            className="shrink-0 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation(); // 行开关已在容器上,不拦会一次点击切换两次
              setDetailOpen((v) => !v);
            }}
          >
            <IconChevronRight
              size={12}
              stroke={1.75}
              aria-hidden
              className={`text-base-content/40 transition-transform ${detailOpen ? "rotate-90" : ""}`}
            />
          </button>
        )}
      </div>
      {/* 发现行的 file:line 复用工作区文件链接通道(ChatView revealMarkdownLink) */}
      {findings && <FindingsCard report={findings} onOpenFile={onLocalLink} />}
      {visibleFeed.length > 0 && (
        <div className="flex flex-col gap-1 px-3 pb-2 ps-6 text-xs">
          {visibleFeed.map((entry, i) => (
            <FeedRow key={feedBase + i} entry={entry} workdir={workdir} />
          ))}
        </div>
      )}
      {!item.background && item.status === "run" && item.lastLine && (
        <div className="truncate px-3 pb-2 ps-6 text-xs text-base-content/50 italic">{item.lastLine}</div>
      )}
      {item.status === "fail" && item.out && !agentResult && (
        <div role="alert" title={item.result || item.out} className="truncate px-3 pb-2 text-xs text-error">
          {item.out}
        </div>
      )}
      {/* 工具产出图片(截图/读图):缩略图点击看大图;裂图防御在 UploadImg */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2 ps-6">
          {images.map((p) => (
            <UploadImg
              key={p}
              load={() => uploadUrl!(p)}
              alt={p}
              title={p}
              className="block max-h-32 max-w-44 cursor-zoom-in rounded-box"
              onClick={() => setZoom(p)}
            />
          ))}
        </div>
      )}
      {zoom && uploadUrl && (
        <Lightbox alt={zoom} onClose={() => setZoom(null)}>
          <UploadImg load={() => uploadUrl(zoom)} alt={zoom} className="max-h-[84vh] max-w-full" />
        </Lightbox>
      )}
      {/* 大字段回读的 loading/失败态行内外显(展开详情或查看结果时触发) */}
      {detailOpen &&
        (fullErr ? (
          <div role="alert" className="px-3 pb-2 text-xs text-error">
            {t("chat.tool.loadFullFailed", { reason: fullErr })}
          </div>
        ) : loadingFull ? (
          <div role="status" className="flex items-center gap-2 px-3 pb-2 text-xs text-base-content/50">
            <span className="loading loading-spinner loading-xs" aria-hidden />
            {t("chat.tool.loadingFull")}
          </div>
        ) : null)}
      {/* 详情 = 单一面板(旧 UI 设计):与状态点缩进对齐,一层边框容器统一
          管滚动/底色,内部 diff 或单 pre,不再盒中盒 */}
      {detailOpen && detail && (
        <div
          aria-label={t("chat.tool.detail")}
          className="mc-workbench-material-muted mx-3 mb-2 ms-6 max-h-[50vh] overflow-auto rounded-box border border-base-300 text-xs"
        >
          <DetailBody detail={detail} />
        </div>
      )}
      {agentDetailOpen && hasAgentModal && (
        <DetailModal
          ariaLabel={t("chat.tool.agentDetail")}
          title={
            <>
              {t("chat.tool.agentDetail")} <span className="text-xs font-normal text-base-content/50">{presentation.action}</span>
            </>
          }
          onClose={() => setAgentDetailOpen(false)}
        >
          <div className="flex flex-col gap-3 text-sm">
            {feed.length > 0 && (
              <div className="mc-workbench-material-muted flex flex-col gap-2 rounded-box border border-base-300 p-3 text-xs">
                {feed.map((entry, i) => (
                  <FeedRow key={entry.kind === "tool" ? entry.id : `text-${i}`} entry={entry} workdir={workdir} />
                ))}
              </div>
            )}
            {item.lastLine && <MarkdownInline source={item.lastLine} className="text-base-content/60" />}
            {fullErr ? (
              <div role="alert" className="text-xs text-error">
                {t("chat.tool.loadFullFailed", { reason: fullErr })}
              </div>
            ) : loadingFull ? (
              <div role="status" className="flex items-center gap-2 text-xs text-base-content/50">
                <span className="loading loading-spinner loading-xs" aria-hidden />
                {t("chat.tool.loadingFull")}
              </div>
            ) : null}
            {agentResult && <Markdown source={agentResult} localImageUrl={uploadUrl} onLocalLink={onLocalLink} />}
            {!feed.length && !item.lastLine && !agentResult && !loadingFull && !fullErr && (
              <div className="text-sm text-base-content/50">{t("chat.tool.agentDetailEmpty")}</div>
            )}
          </div>
        </DetailModal>
      )}
      {perm && (
        <div className="flex flex-col gap-2 border-t border-base-300 px-3 py-2">
          <div className="text-xs font-semibold text-warning">
            {`${t("chat.perm.needConfirm")} · ${perm.tool ? toolDisplayName(perm.tool, locale) : t("chat.perm.genericAction")}`}
          </div>
          {/* key=perm.id:同一张工具卡先后锚定不同审批时,内嵌行的乐观态
              (local)随审批重置——否则二次 open 时按钮行被旧徽标顶掉 */}
          <PermActions key={perm.id} perm={perm} sessionId={sessionId} sendFrame={sendFrame} />
        </div>
      )}
    </div>
  );
}
