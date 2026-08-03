// 云端任务详情视图(纯视图层):在桌面内回放/跟看/操作 monkeycode 云端
// 任务,不开浏览器。连接编排与投递状态机全部在 useCloudTask 里收口,
// 这里只消费 CloudTaskHandle + 持有纯 UI 状态(菜单/抽屉/终端开合)。
// 渲染复用本地会话的帧归约链(reduceBatch → LogList):云端帧与本地 Frame 同构。
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { openExternal } from "./host";
import type { CloudTask } from "./types";
import { cloudModelLabel, groupedCloudModelLabel } from "./cloud";
import { CloudFilesDrawer } from "./cloudfiles";
import { CloudTerminal } from "./cloudterm";
import { MAX_CLOUD_ATTS } from "./cloudUpload";
import { COL_MAX, ModelPickerTrigger } from "./chat";
import { CloudModelGroups } from "./cloudModelMenu";
import { useCloudOutlineNav } from "./cloudOutline";
import { CloudStartupCard } from "./cloudStartup";
import { SlashCommandMenu, useSlashCommands } from "./commandMenu";
import { HeaderFilesButton, HeaderMenu, LogList, OutlineNav, TaskPanel, ViewHeader, type MenuState } from "./components";
import { Composer, QueuedChip, RunningBar } from "./composer";
import { IconCloud, IconFile, IconGlobe, IconMonitor, IconPaperclip, IconStop, IconX } from "./icons";
import { useUpwardMenuHeight } from "./menuPosition";
import { useNativeFileDrop } from "./nativeDrop";
import { cloudStatusHealthy, useCloudTask } from "./useCloudTask";

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: "排队中", color: "var(--warn)" },
  processing: { text: "运行中", color: "var(--accTx)" },
  error: { text: "出错", color: "var(--err)" },
  finished: { text: "已完成", color: "var(--t4)" },
};

export function CloudTaskView({
  task,
  mcHost,
  onTasksChanged,
}: {
  /** 侧栏/新建入口带进来的任务(至少含 id;详情异步补全) */
  task: CloudTask;
  mcHost: string;
  /** 状态变化(停止/结束)后让 App 刷新侧栏列表;关闭视图走 App 的 Esc/侧栏切换 */
  onTasksChanged?: () => void;
}) {
  const h = useCloudTask(task, { onTasksChanged });
  const { taskStatus, ended, vmId, vmStatus, vmWaking, running, queued, chat, meta } = h;

  // 终止任务确认放在 ⋯ 菜单里(与 ChatView 删除会话的交互一致,共享 HeaderMenu)
  const [menu, setMenu] = useState<MenuState>("closed");

  // 文件抽屉 / 终端面板(控制流与终端 WS 均走内核代理)
  const [filesOpen, setFilesOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);

  // ===== 附件入口(选择/粘贴/拖入;上传与额度在 hook)=====
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (ended) return;
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      h.addFiles(files);
    }
  };
  // 拖拽文件进对话区(与本地 ChatView 同一套 DOM 事件;Linux 走原生通道)
  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (ended || ![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (--dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (ended) return;
    const files = [...e.dataTransfer.files];
    if (files.length) h.addFiles(files);
  };
  useNativeFileDrop({
    enabled: !ended,
    wantContent: true, // 云端附件要上行对象存储,必须拿字节(整包 20MB 限)
    onDragging: setDragging,
    onFiles: (files) => h.addFiles(files),
    onError: (msg) => h.notify("⚠ 附件上传失败: " + msg),
  });

  // 斜杠指令(Agent 上报):composer 左侧 / 按钮,或在输入框直接敲 / 就地补全
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const slash = useSlashCommands({
    commands: h.commands,
    input: h.input,
    setInput: h.setInput,
    inputRef,
    enabled: !ended,
  });

  // 提问大纲(REST 索引 + 实时用户消息;交互复用本地 OutlineNav)
  const nav = useCloudOutlineNav(h.id, chat.items, h);

  // 云端模型下拉开合(列表加载/切换在 hook)
  const [modelOpen, setModelOpen] = useState(false);
  const { anchorRef: modelAnchorRef, menuMaxHeight: modelMenuMaxHeight } = useUpwardMenuHeight<HTMLSpanElement>(modelOpen, 320);
  const openModelPicker = () => {
    setModelOpen((o) => !o);
    h.loadModels();
  };

  const st = STATUS_LABEL[taskStatus] ?? { text: taskStatus, color: "var(--t4)" };

  return (
    <div
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, position: "relative" }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && !ended && (
        <div
          style={{
            position: "absolute",
            inset: 8,
            zIndex: 20,
            border: "2px dashed var(--acc)",
            borderRadius: 14,
            background: "var(--accBgSoft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--accTx)",
          }}
        >
          松开以添加附件
        </div>
      )}
      {/* ==== 标题栏:共享 ViewHeader(与 ChatView 同一几何)==== */}
      <ViewHeader
        title={h.label}
        titleTip={h.label}
        subtitle={
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--t5)", minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.color === "var(--t4)" ? "var(--t6)" : st.color, flex: "none" }} />
            <span style={{ fontWeight: 600, color: st.color, flex: "none" }}>{st.text}</span>
            {/* 云环境休眠/唤醒外显:打开对话即触发唤醒(常驻控制连接),这里给可见反馈 */}
            {vmWaking && (
              <>
                <span style={{ color: "var(--t7)", flex: "none" }}>·</span>
                <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5, borderColor: "var(--warn)", borderTopColor: "transparent" }} />
                <span style={{ fontWeight: 600, color: "var(--warn)", flex: "none" }}>环境唤醒中</span>
              </>
            )}
            {taskStatus === "processing" && vmStatus === "offline" && (
              <>
                <span style={{ color: "var(--t7)", flex: "none" }}>·</span>
                <span style={{ fontWeight: 600, color: "var(--t5)", flex: "none" }}>环境离线</span>
              </>
            )}
            <span style={{ color: "var(--t7)", flex: "none" }}>·</span>
            <IconCloud size={11} color="var(--t6)" />
            <span style={{ flex: "none" }}>云端</span>
            {meta?.model && (
              <>
                <span style={{ color: "var(--t7)", flex: "none" }}>·</span>
                <span className="ellipsis">{cloudModelLabel(meta.model)}</span>
              </>
            )}
          </span>
        }
      >
        {/* 头部只留两个控件(与本地会话一致):文件 + ⋯;终端/网页/预览/终止收进菜单 */}
        <HeaderFilesButton title="浏览云端工作区文件(标注改动)" onClick={() => setFilesOpen(true)} />
        <HeaderMenu
          menu={menu}
          setMenu={(next) => {
            setMenu(next);
            if (next === "open") h.fetchPorts();
          }}
          minWidth={180}
          confirm={{
            message: "终止后云端虚拟机将回收,任务不可继续。",
            confirmLabel: "确认终止",
            onConfirm: () => void h.stopTask(),
          }}
        >
          {vmId && !ended && (
            <button
              className="hv menu-item"
              onClick={() => {
                setMenu("closed");
                setTermOpen((o) => !o);
              }}
              style={{ gap: 8 }}
            >
              <IconMonitor size={13} strokeWidth={1.4} color="var(--t3)" />
              <span style={{ flex: 1 }}>{termOpen ? "关闭终端" : "打开终端"}</span>
            </button>
          )}
          <button
            className="hv menu-item"
            title="完整控制台:预览/共享终端/文件下载等"
            onClick={() => {
              setMenu("closed");
              openExternal(`https://${mcHost}/console/task/${h.id}`);
            }}
            style={{ gap: 8 }}
          >
            <IconGlobe size={13} color="var(--t3)" />
            <span style={{ flex: 1 }}>在浏览器打开</span>
          </button>
          {!ended && vmId && (
            <>
              <span style={{ height: 1, background: "var(--line2)", margin: "4px 6px" }} />
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--t6)", padding: "5px 9px 3px" }}>
                在线预览
              </span>
              {h.ports === null && (
                <div style={{ padding: "3px 9px 6px", fontSize: 11.5, color: "var(--t5)" }}>检测开放端口…</div>
              )}
              {h.ports !== null && h.ports.filter((p) => p.access_url).length === 0 && (
                <div style={{ padding: "3px 9px 6px", fontSize: 11.5, color: "var(--t5)" }}>没有开放的端口</div>
              )}
              {(h.ports ?? [])
                .filter((p) => p.access_url)
                .map((p) => (
                  <button
                    key={p.port}
                    className="hv menu-item"
                    title={p.access_url}
                    onClick={() => {
                      setMenu("closed");
                      openExternal(p.access_url!);
                    }}
                    style={{ gap: 8 }}
                  >
                    <IconGlobe size={12} color="var(--accTx)" />
                    <span style={{ flex: 1, minWidth: 0 }} className="ellipsis">
                      :{p.port} {p.label || p.process || ""}
                    </span>
                  </button>
                ))}
            </>
          )}
          {!ended && (
            <>
              <span style={{ height: 1, background: "var(--line2)", margin: "4px 6px" }} />
              <button className="hv-errbg menu-item" style={{ color: "var(--err)" }} onClick={() => setMenu("confirm")}>
                <IconStop color="var(--err)" />
                终止任务
              </button>
            </>
          )}
        </HeaderMenu>
      </ViewHeader>

      {/* ==== 启动页(pending):VM 准备是以分钟计的过程,给足过程感 ====
          此时必然还没有任何对话(首轮要等环境就绪才开跑),整屏让给启动卡 */}
      {taskStatus === "pending" ? (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 36px" }}>
          <CloudStartupCard meta={meta} queued={!!queued} />
        </div>
      ) : (
        /* ==== 对话流:列宽公式与滚动条预留同 ChatView;内距 36px 是本视图自己的
                尺度,与下方 composer 对齐即可(ChatView 那边是 30px) ==== */
        <div
          ref={h.scrollRef}
          onWheel={h.onWheel}
          onScroll={() => {
            h.onScroll();
            nav.onScrollTick();
          }}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0, scrollbarGutter: "stable both-edges" }}
        >
          <div style={{ maxWidth: COL_MAX, margin: "0 auto", padding: "26px 36px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
            {h.cursor && (
              <button
                className="hv"
                onClick={() => void h.loadEarlier()}
                style={{ alignSelf: "center", border: "1px solid var(--line)", background: "var(--card)", color: "var(--t3)", fontSize: 11.5, borderRadius: 8, padding: "4px 14px", cursor: "pointer", boxShadow: "var(--cardSh)" }}
              >
                {h.loadingEarlier ? "加载中…" : "加载更早的对话"}
              </button>
            )}
            {chat.items.length === 0 && (
              <div style={{ padding: "40px 0", textAlign: "center", fontSize: 12.5, color: "var(--t5)" }}>
                {ended ? "没有可回放的对话记录。" : h.status}
              </div>
            )}
            <LogList items={chat.items} onPermAnswer={() => {}} onAskAnswer={ended ? undefined : h.answerAsk} workdir="/workspace" />
          </div>
        </div>
      )}

      {/* ==== 运行条 + 终端卡 + composer:与 ChatView 同列宽同出血 ==== */}
      <div style={{ flex: "none", maxWidth: COL_MAX, width: "calc(100% - 16px)", margin: "0 auto", padding: "0 36px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* 实时任务面板(与本地会话同款,钉住不进流) */}
        {chat.plan.length > 0 && <TaskPanel entries={chat.plan} />}
        {/* 终端:对话列同宽的圆角深色悬浮卡(与 composer 同出血),融入卡片语言 */}
        {termOpen && vmId && !ended && (
          <div
            style={{
              height: 280,
              margin: "0 -12px",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid var(--line)",
              boxShadow: "var(--panelShLg)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              background: "var(--termBg)",
              animation: "mcin .2s ease",
            }}
          >
            <div style={{ flex: "none", height: 32, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", background: "var(--termHdr)", borderBottom: "1px solid var(--termBd)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--termAcc)", flex: "none" }} />
              <span style={{ color: "var(--termTx)", fontSize: 11.5, fontWeight: 600 }}>云端终端</span>
              <span style={{ color: "var(--termTx3)", fontSize: 11 }}>任务虚拟机 · /workspace</span>
              <span style={{ flex: 1 }} />
              <button className="icon-btn" title="关闭终端" onClick={() => setTermOpen(false)} style={{ width: 22, height: 22, borderRadius: 6 }}>
                <IconX size={10} color="var(--termTx2)" />
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <CloudTerminal vmId={vmId} />
            </div>
          </div>
        )}
        {h.err && <div style={{ fontSize: 12, color: "var(--err)" }}>{h.err}</div>}
        {running && (
          <RunningBar
            label="云端执行中"
            detail={`第 ${h.roundNo} 轮`}
            stopTitle="中断当前执行(任务保留,可继续对话)"
            onStop={h.cancel}
          />
        )}

        {queued && !ended && (
          <QueuedChip
            text={h.queuedAtts > 0 ? `${queued}(+${h.queuedAtts} 附件)` : queued}
            hint={taskStatus === "pending" ? "环境就绪后自动发送" : vmWaking ? "环境唤醒后自动发送" : "本轮结束后自动发送"}
            onClear={h.clearQueued}
          />
        )}

        {ended ? (
          <div style={{ fontSize: 12, color: "var(--t5)", textAlign: "center", padding: "4px 0" }}>
            任务已结束,只读回放。需要继续可新建云端任务。
          </div>
        ) : (
          <Composer
            value={h.input}
            placeholder={
              taskStatus === "pending"
                ? "环境启动中…现在发送会排队,就绪后自动送达"
                : vmWaking
                  ? "环境唤醒中…现在发送会排队,唤醒后自动送达"
                  : running
                    ? "补充说明…运行中发送会排队"
                    : h.commands.length > 0
                      ? "继续对话…输入 / 使用技能,可粘贴或拖入附件"
                      : "继续对话…粘贴或拖入图片、文件可作为附件"
            }
            sendActive={!!h.input.trim()}
            onChange={h.setInput}
            onSend={h.send}
            onPaste={onPaste}
            onKeyDown={slash.onKeyDown}
            inputRef={inputRef}
            above={
              (h.atts.length > 0 || h.uploading > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 12px 0" }}>
                  {h.atts.map((a, i) => (
                    <span key={a.url} style={{ position: "relative", display: "flex" }}>
                      {a.isImage && a.preview ? (
                        <img
                          src={a.preview}
                          alt={a.filename}
                          title={a.filename}
                          style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--cardBd)" }}
                        />
                      ) : (
                        <span
                          title={a.filename}
                          style={{
                            height: 30,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "0 10px",
                            borderRadius: 8,
                            border: "1px solid var(--cardBd)",
                            background: "var(--codeBg)",
                            fontSize: 12,
                            color: "var(--t2)",
                            maxWidth: 220,
                          }}
                        >
                          <IconFile size={12} color="var(--t4)" />
                          <span className="ellipsis">{a.filename}</span>
                        </span>
                      )}
                      <button
                        className="icon-btn"
                        title="移除"
                        onClick={() => h.removeAtt(i)}
                        style={{
                          position: "absolute",
                          top: -5,
                          right: -5,
                          width: 17,
                          height: 17,
                          border: "1px solid var(--line)",
                          borderRadius: "50%",
                          background: "var(--card)",
                          boxShadow: "var(--cardSh)",
                        }}
                      >
                        <IconX size={8} color="var(--t3)" />
                      </button>
                    </span>
                  ))}
                  {h.uploading > 0 && (
                    <span
                      style={{
                        height: 30,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "0 10px",
                        borderRadius: 8,
                        border: "1px dashed var(--cardBd)",
                        fontSize: 12,
                        color: "var(--t5)",
                      }}
                    >
                      <span className="spinner" style={{ width: 10, height: 10 }} />
                      上传中…
                    </span>
                  )}
                </div>
              )
            }
            controls={
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = ""; // 允许重复选同一文件
                    if (files.length) h.addFiles(files);
                  }}
                />
                <button
                  className="hv2 icon-btn"
                  title={`添加附件(图片/文件,单个 ≤2MB,最多 ${MAX_CLOUD_ATTS} 个)`}
                  onClick={() => fileRef.current?.click()}
                  style={{ width: 24, height: 24, borderRadius: 7, opacity: h.atts.length >= MAX_CLOUD_ATTS ? 0.4 : 1 }}
                >
                  <IconPaperclip size={13} color="var(--t3)" />
                </button>
                {/* 使用技能(斜杠指令):点开浏览全部,或在输入框直接敲 / 就地补全 */}
                <SlashCommandMenu h={slash} count={h.commands.length} />
                {/* 连接状态:健康时隐藏(常驻"已连接云端"没有信息量),
                    过渡/异常态才外显(断线重连、消息未送达等) */}
                {!cloudStatusHealthy(h.status) && (
                  <span
                    title={`${h.status} · 任务运行在云端服务器,关掉客户端也会继续`}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--t5)", minWidth: 0 }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: h.connected ? "var(--ok)" : "var(--t6)", flex: "none" }} />
                    <span className="ellipsis">{h.status}</span>
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {/* 云端模型切换(经控制流 switch_model,保留会话上下文;执行中禁用) */}
                {/* 包裹层接住 trigger 的 maxWidth:100%(与本地 ModelPicker 同款
                    收缩语义):长云端模型名截断而不是撑破 composer 行 */}
                <span
                  ref={modelAnchorRef}
                  style={{ position: "relative", display: "flex", flex: "0 1 auto", minWidth: 0, maxWidth: 220 }}
                >
                  <ModelPickerTrigger
                    label={h.switching ? "切换中…" : meta?.model ? groupedCloudModelLabel(meta.model) : ""}
                    open={modelOpen}
                    title={running ? "执行中不可切换模型" : `${cloudModelLabel(meta?.model) || "云端模型"} · 点击切换`}
                    disabled={running || h.switching}
                    onClick={openModelPicker}
                  />
                  {modelOpen && (
                    <>
                      <div className="backdrop" onClick={() => setModelOpen(false)} />
                      <div className="pop model-menu" style={{ position: "absolute", bottom: 30, right: 0, maxHeight: modelMenuMaxHeight, overflowY: "auto" }}>
                        {h.cloudGroups !== null && (
                          <CloudModelGroups
                            groups={h.cloudGroups}
                            selectedId={meta?.model?.id}
                            onPick={(m) => {
                              if (m.locked) return;
                              setModelOpen(false);
                              void h.switchModel(m.id!);
                            }}
                          />
                        )}
                        {h.cloudGroups === null && (
                          <span style={{ fontSize: 11.5, color: "var(--t6)", padding: "6px 9px" }}>加载中…</span>
                        )}
                        {h.cloudGroups !== null && h.cloudGroups.length === 0 && (
                          <span style={{ fontSize: 11.5, color: "var(--t6)", padding: "6px 9px" }}>没有可用模型</span>
                        )}
                      </div>
                    </>
                  )}
                </span>
              </>
            }
          />
        )}
      </div>

      {/* ==== 提问大纲(与本地会话同款点列+浮窗;启动页没有对话流,不挂)==== */}
      {taskStatus !== "pending" && <OutlineNav entries={nav.entries} activeSeq={nav.activeSeq} onJump={nav.onJump} />}

      {/* ==== 云端文件抽屉(共享 FilesDrawer 浮层,数据经控制流适配;
          上传只对未结束任务开放——结束态 VM 已回收,写不进去)==== */}
      {filesOpen && <CloudFilesDrawer taskId={h.id} vmId={ended ? undefined : vmId} onClose={() => setFilesOpen(false)} />}
    </div>
  );
}
