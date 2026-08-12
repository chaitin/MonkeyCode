// 全功能 composer:自适应高度输入(IME 守卫)+ 斜杠指令面板 + 附件
// (对话框/粘贴;拖拽由 ChatView 转入 ctl.addFiles)+ 运行条/排队 chip +
// 模型/思考档/权限模式控制。状态机在 useComposer,纯逻辑在 lib/util/slash。
// 发送面契约见 useComposer 文件头;切模型/思考/模式经 lib/ipc/controls
// (session_call),成功不乐观回写——壳会补 model_update / think_update /
// permission_mode_update 帧,ChatState 是唯一真值。
import { IconClock, IconPaperclip, IconSend, IconX } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useI18n } from "@/lib/i18n";
import { useEscLayer } from "@/lib/util/escLayer";
import { sessionSetMode, sessionSetModel, sessionSetSkills, sessionSetThink } from "@/lib/ipc/controls";
import { afterEngineReady } from "@/lib/ipc/engine";
import { modelMenuList, resolveModelName } from "@/lib/models/modelMenu";
import { modelsList, type ModelInfo, type SessionMeta } from "@/lib/ipc/sessions";
import { defaultEnabledSkills, skillsList, type SkillInfo } from "@/lib/ipc/skills";
import { pickAttachmentPaths } from "@/lib/ipc/uploads";
import type { ChatState, SlashCommand } from "@/lib/protocol/types";
import { fmtK } from "@/lib/util/fmt";
import { commandText, createImeGuard, cycleIndex, filterCommands, slashQuery } from "@/lib/util/slash";
import { ComposerCard, ComposerTextarea, ErrorBar, RunBar, SlashPanel, UsageRing } from "./composerKit";
import { ModelMenu, SkillsMenu, ThinkMenu } from "./pickers";
import type { ComposerCtl } from "./useComposer";

// 模型/思考档下拉的形态与逻辑收口在 ./pickers(新建任务页共用同一组件);
// 模型展示投影(短名/档位)统一走 lib/models/modelMenu(protocol/reduce.ts
// 的 model_update 系统行是同一剥名口径,几处必须一致)。

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function Composer({
  sessionId,
  state,
  meta,
  ctl,
  onAfterSend,
}: {
  sessionId: string;
  state: ChatState;
  meta: SessionMeta;
  ctl: ComposerCtl;
  onAfterSend?: () => void;
}) {
  const { t } = useI18n();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const imeRef = useRef(createImeGuard());
  const [models, setModels] = useState<ModelInfo[]>([]);

  // 模型清单一次拉取(锁定项禁选;浏览器模式为空,触发器仍显当前名)。
  // 失败保留上一份而不是清空:modelsList 自 2026-08-09 起会**抛**(此前吞成
  // [],把 afterEngineReady 的重试变成了死代码),而引擎重启期这一拉必然
  // 撞上壳的「配置应用中」闸门——清空就是"重启一次模型菜单就空了";
  // 且未处理拒绝会被 index.html 的兜底画成满屏红框。
  // afterEngineReady 不可省:ChatView 挂 `key={epoch}`,引擎 Ready 且此前掉过
  // 时整棵树重建,于是这一拉与 useSessionFeed 的 session_open 在**同一次
  // commit 里同刻**打到壳上——后者有 4 次退避、前者一次都没有,只有它会被
  // 「配置应用中」闸门拒掉。而 Composer 是全新实例、models 从 [] 起,上面
  // 那句"失败保留上一份"在挂载这一次是空话:结果就是模型下拉只剩「尚未配置
  // 模型」,且本实例活着期间换不了模型(key 只认 epoch,切会话也不重建),
  // 顺带 models.find(...)?.think 恒 undefined、思考档触发器回落「低」给错读数。
  useEffect(() => {
    let alive = true;
    void afterEngineReady(modelsList)
      .then((list) => {
        if (alive && Array.isArray(list)) setModels(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ==== 会话技能(库 + 本会话启用集) ====
  // 库一次拉取(纯壳侧文件读取,不吃引擎重启闸门);失败保留上一份,
  // 口径同上方 modelsList。启用集以 sidecar 快照(meta.skills)起步,
  // 变更走 session_set_skills(壳 destroy+resume 重建),成功后本地即为
  // 真值——壳不产技能帧,不能指望 ChatState 回写。
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  useEffect(() => {
    let alive = true;
    void skillsList()
      .then((list) => {
        if (alive && Array.isArray(list)) setSkills(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [enabledSkills, setEnabledSkills] = useState<string[] | null>(meta.skills ?? null);
  // 切会话跟随该会话的 sidecar 快照;不依赖 meta 引用(列表轮询的旧值
  // 会打回刚勾选的乐观状态)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEnabledSkills(meta.skills ?? null), [sessionId]);
  const pickSkills = (next: string[]) => {
    const prev = enabledSkills;
    setEnabledSkills(next);
    void sessionSetSkills(sessionId, next).catch((e) => {
      setEnabledSkills(prev);
      ctl.notifyError(t("chat.skills.failed", { reason: errText(e) }));
    });
  };
  // null = 缺省集(与 SkillsMenu、壳侧物化同一规则,lib/ipc/skills.ts)
  const enabledSkillList = useMemo(() => {
    const on = enabledSkills ?? defaultEnabledSkills(skills);
    return skills.filter((s) => on.includes(s.name));
  }, [skills, enabledSkills]);

  // ==== 斜杠指令面板(首字符 / 就地补全) ====
  // 本地会话内置指令:引擎不产 available_commands_update 帧(该帧目前只有
  // 云端在喂),没有内置表的话本地面板永远弹不出来。/compact 的执行在
  // useComposer.send() 拦截(经 session_call 直达壳,不进消息通道);同名
  // 时内置项优先,引擎将来若下发 compact 不会出现双条目。
  // 已启用技能也进面板:引擎原生支持 `/技能名 参数` 斜杠展开(消息进模型前
  // 确定性替换),这里只做补全,发送按普通文本走 user-input。
  const builtinCommands = useMemo<SlashCommand[]>(
    () => [
      { name: "compact", description: t("chat.cmd.compact") },
      ...enabledSkillList.map((s) => ({ name: s.name, description: s.description })),
    ],
    [t, enabledSkillList],
  );
  const commands = useMemo(
    () => [...builtinCommands, ...state.commands.filter((c) => !builtinCommands.some((b) => b.name === c.name))],
    [builtinCommands, state.commands],
  );
  const [slashSuppressed, setSlashSuppressed] = useState(false);
  const [active, setActive] = useState(0);
  const query = slashQuery(ctl.draft);
  const slashOpen = query !== null && !slashSuppressed && commands.length > 0;
  const list = useMemo(() => filterCommands(commands, query ?? ""), [commands, query]);
  const act = Math.min(active, Math.max(0, list.length - 1));
  useEffect(() => setActive(0), [query, commands]);
  // `/` 段被清掉 → 解除压制,下次敲 / 照常补全
  useEffect(() => {
    if (query === null) setSlashSuppressed(false);
  }, [query]);

  const pickCommand = (cmd: SlashCommand) => {
    ctl.setDraft(commandText(cmd));
    // 填入的文本自己就是一段 /name,不压住的话面板会立刻回弹匹配自己
    setSlashSuppressed(true);
    taRef.current?.focus();
  };

  // Esc 关闭斜杠面板走统一层栈(lib/util/escLayer):面板打开时才入栈,层序
  // (后入先得)保证它压过视图级 Esc;返回 true = 消费即截断,不许漏给冒泡
  // 阶段的全局审批热键(esc = deny 不可逆)。此前是自己挂 window capture,
  // 而同阶段同 target 按**注册先后**触发,谁先挂载谁先吃——见 escLayer 头注。
  // (模型/思考档 dropdown 的 Esc 走 useDismiss,同一条层栈。)
  useEscLayer(
    slashOpen,
    useCallback(() => {
      setSlashSuppressed(true);
      return true;
    }, []),
  );

  // ==== 模型 / 思考档 / 权限模式 ====
  // resolveModelName:会话记的可能是**加来源后缀之前**的裸名(升级前建的会话),
  // 严格比对的话下拉里一项都选不中、来源 tab 也算成空串停在「自定义」,
  // modelThink 同样查不到 → 思考档触发器回落「低」给出错读数。
  // modelMenuList:模型被删/改名后补一条兜底项,否则连"当前用的是哪条"都看不出。
  const currentModel = resolveModelName(models, state.model || meta.model);
  const menuModels = modelMenuList(models, currentModel);
  const modelThink = models.find((m) => m.name === currentModel)?.think;
  const effThink = state.think || meta.think || modelThink || "low";
  const mode = state.permMode || meta.mode || "default";
  const yolo = mode === "yolo";

  const pickModel = (name: string) => {
    if (!name || name === currentModel) return;
    void sessionSetModel(sessionId, name).catch((e) => {
      ctl.notifyError(t("chat.model.failed", { reason: errText(e) }));
    });
  };
  const pickThink = (level: string) => {
    if (level === effThink) return;
    void sessionSetThink(sessionId, level).catch((e) => {
      ctl.notifyError(t("chat.think.failed", { reason: errText(e) }));
    });
  };
  // 权限模式可运行中热切(壳侧支持;yolo 切入时壳自动放行挂起审批)
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const toggleMode = () => {
    const next = modeRef.current === "yolo" ? "default" : "yolo";
    void sessionSetMode(sessionId, next).catch((e) => {
      ctl.notifyError(t("chat.mode.failed", { reason: errText(e) }));
    });
  };
  // ⇧⇥ 与 pill 点击同一动作
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey) return;
      e.preventDefault();
      toggleMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // toggleMode 经 modeRef 取最新值,处理器可长期持有
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ==== 发送 / 键盘 ====
  const submit = () => {
    if (ctl.send()) onAfterSend?.();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // 斜杠面板优先:↑↓/↩/⇥ 归面板,不落到发送
    if (slashOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(cycleIndex(act, e.key === "ArrowDown" ? 1 : -1, list.length));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && list.length > 0) {
        // IME 组合态的 ↩ 是选字确认,不是选指令(与发送同一守卫)
        if (e.key === "Enter" && imeRef.current.isImeEnter(e.timeStamp, e.nativeEvent.isComposing)) return;
        e.preventDefault();
        pickCommand(list[act]!);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // IME 组合期(或 WKWebView 上组合刚结束 100ms 窗口内)的 Enter 是选字
      if (imeRef.current.isImeEnter(e.timeStamp, e.nativeEvent.isComposing)) return;
      e.preventDefault();
      submit();
    }
  };

  // 粘贴附件:剪贴板 file item(截图/复制的文件)转附件,文本粘贴不受影响
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      void ctl.addFiles(files);
    }
  };

  const attach = () => {
    void pickAttachmentPaths(t("chat.attachDialogTitle")).then((paths) => {
      if (paths.length) void ctl.addPaths(paths);
    });
  };

  // ==== 运行态文案 ====
  const openPerm = state.items.some((it) => it.kind === "perm" && it.state === "open");
  const anyToolRunning = state.items.some((it) => it.kind === "tool" && it.status === "run");
  const runningLabel = openPerm
    ? t("chat.running.waitPerm")
    : anyToolRunning
      ? t("chat.running.acting")
      : t("chat.running.thinking");
  // 运行条 detail:「第 N 轮 · X tokens」(旧 UI RunningBar 同款;轮数 = user 项计数)
  const roundNo = Math.max(1, state.items.filter((it) => it.kind === "user").length);
  const runningDetail =
    t("chat.running.round", { round: roundNo }) +
    (state.usage && state.usage.used > 0 ? ` · ${fmtK(state.usage.used)} tokens` : "");
  const usagePct =
    state.usage && state.usage.size > 0 ? Math.round((state.usage.used / state.usage.size) * 100) : null;

  return (
    <div className="flex flex-col gap-2">
      {/* composer 域的两条瞬态反馈,统一形态(错误条件收口在 composerKit):
          soft 底 + 14px 语义图标 + truncate 正文 + 右端关闭 */}
      {ctl.error && <ErrorBar text={ctl.error} onDismiss={ctl.dismissError} />}

      {ctl.queued && (
        <div className="alert alert-soft -mx-2.5 flex items-center gap-2 px-3 py-1.5 text-xs">
          <IconClock size={14} stroke={1.75} aria-hidden className="shrink-0 text-base-content/50" />
          <span className="shrink-0 font-medium">{t("chat.queued")}</span>
          <span className="min-w-0 flex-1 truncate">{ctl.queued}</span>
          <span className="shrink-0 text-base-content/50">{t("chat.queuedHint")}</span>
          <button
            type="button"
            aria-label={t("chat.queuedCancel")}
            className="btn btn-ghost btn-square btn-xs"
            onClick={ctl.clearQueued}
          >
            <IconX size={14} stroke={1.75} aria-hidden />
          </button>
        </div>
      )}

      {/* 输入卡外框(形态收口在 composerKit:出血/聚焦边线/禁挂 dropdown 类
          的缘由见 ComposerCard 头注)。斜杠面板是卡内自绘浮层(绝对定位,
          焦点始终留在 textarea) */}
      <ComposerCard>
        {slashOpen && (
          <SlashPanel list={list} active={act} onHover={setActive} onPick={pickCommand} />
        )}

        {/* 运行条:一行紧凑态——spinner + 文案 + 停止 icon 按钮 */}
        {state.running && <RunBar label={runningLabel} detail={runningDetail} stopLabel={t("chat.stop")} onStop={ctl.stop} />}

        {(ctl.uploads.length > 0 || ctl.atts.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {ctl.uploads.map((u) => (
              <span key={u.id} className="badge badge-ghost text-xs">
                <span className="loading loading-spinner loading-xs" aria-hidden />
                <span className="max-w-40 truncate">{u.name}</span>
                {u.pct >= 0 && <span className="tabular-nums opacity-60">{u.pct}%</span>}
                {u.cancel && (
                  <button type="button" aria-label={t("chat.uploadCancel")} className="btn btn-ghost btn-circle btn-xs" onClick={u.cancel}>
                    <IconX size={12} stroke={1.75} aria-hidden />
                  </button>
                )}
              </span>
            ))}
            {ctl.atts.map((a, i) => (
              <span key={a.path} title={a.path} className="badge badge-ghost text-xs">
                <span className="max-w-40 truncate">{a.name}</span>
                <button type="button" aria-label={t("chat.attachRemove")} className="btn btn-ghost btn-circle btn-xs" onClick={() => ctl.removeAtt(i)}>
                  <IconX size={12} stroke={1.75} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}

        <ComposerTextarea
          taRef={taRef}
          aria-label={t("chat.composer")}
          placeholder={state.running ? t("chat.composerPlaceholderRunning") : t("chat.composerPlaceholder")}
          value={ctl.draft}
          onChange={(e) => ctl.setDraft(e.target.value)}
          onCompositionEnd={(e) => imeRef.current.markEnd(e.timeStamp)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        {/* min-w-0:长模型名可收缩截断,不得把发送按钮挤出卡片。
            排布:左端 = 附件入口 + 模式 pill(用户定案 2026-08-06 对调,
            附件贴左缘),右端 = 思考/模型/用量/发送(输入侧元信息与动作)。
            ps-1 光学对齐:1px 边 + 4px + btn-xs 内距 8px = 13px,首个按钮
            的**内容**左缘与 textarea 文字(1px 边 + 12px 内距)重合——这排
            与输入文字/正文同一条竖线。pe-2:发送钮是实底色块没有幽灵内距,
            贴 4px 边显挤,右侧多留一档 */}
        <div className="flex min-w-0 items-center gap-1 ps-1 pe-2 pb-1.5">
          <button
            type="button"
            aria-label={t("chat.attach")}
            title={t("chat.attachTip")}
            className="btn btn-ghost btn-square btn-xs shrink-0 text-base-content/60"
            onClick={attach}
          >
            <IconPaperclip size={15} stroke={1.75} aria-hidden />
          </button>
          <button
            type="button"
            title={t("chat.mode.tip")}
            className={`btn btn-xs ${yolo ? "btn-warning btn-soft" : "btn-ghost font-medium text-base-content/70"}`}
            onClick={toggleMode}
          >
            {yolo ? t("chat.mode.yolo") : t("chat.mode.default")}
          </button>
          <span className="min-w-0 flex-1" />

          <SkillsMenu
            skills={skills}
            enabled={enabledSkills}
            onChange={pickSkills}
            disabled={state.running}
            title={state.running ? t("chat.switchWhileRunning") : t("chat.skills.tip")}
          />
          <ThinkMenu
            current={effThink}
            onPick={pickThink}
            disabled={state.running}
            title={state.running ? t("chat.switchWhileRunning") : t("chat.think.tip")}
          />
          <ModelMenu
            models={menuModels}
            current={currentModel}
            onPick={pickModel}
            disabled={state.running}
            title={state.running ? t("chat.switchWhileRunning") : t("chat.model.tip")}
          />

          {/* 布局规范:上下文用量是输入侧元信息,归 composer 集群右端
              (形态收口在 composerKit/UsageRing) */}
          <UsageRing
            pct={usagePct}
            label={t("chat.contextUsage")}
            tip={
              usagePct !== null && state.usage
                ? t("chat.usageTip", {
                    pct: usagePct,
                    used: fmtK(state.usage.used),
                    size: fmtK(state.usage.size),
                  })
                : t("chat.usageEmpty")
            }
          />
          <button
            type="button"
            aria-label={t("chat.send")}
            title={t("chat.sendTip")}
            className="btn btn-primary btn-square btn-sm shrink-0"
            disabled={!ctl.draft.trim() && ctl.atts.length === 0}
            onClick={submit}
          >
            <IconSend size={16} stroke={1.75} aria-hidden />
          </button>
        </div>
      </ComposerCard>
    </div>
  );
}
