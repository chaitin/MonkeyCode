// 审批卡与审批按钮行。按钮行(PermActions)同时供工具卡内嵌(锚定态)
// 复用——同一套动作词汇与乐观回写只维护一份,两处渲染不漂移。
// 答复后先本地乐观置态(按钮换成结果徽标),permission-resolved 帧随后
// 带权威 outcome 回写 ChatState(归约层已处理);发送失败回滚可重点。
import { IconHandStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import {
  engineCaps,
  localFrameSender,
  sendPermAnswerVia,
  type FrameSender,
  type PermAction,
} from "@/lib/ipc/approvals";
import { permStateKey } from "@/lib/protocol/reduce";
import { localizedToolTitleText } from "@/lib/tools/toolLabels";
import type { PermItem } from "@/lib/protocol/types";

/** 审批状态词:归约层只给键(未知态给 null),这里按当前 locale 求值。
 *  未知态原样显示服务端字符串——认不出的状态也好过一片空白。 */
function permText(state: string, t: ReturnType<typeof useI18n>["t"]): string {
  const key = permStateKey(state);
  return key ? t(key) : state;
}

/** 审批按钮行:允许/本会话始终/此项目永久/拒绝 + ⏎/esc 快捷键脚注。
 * engine_caps.perm_remember 为 false 时隐藏两个"始终"档。 */
export function PermActions({
  perm,
  sessionId,
  sendFrame,
}: {
  perm: PermItem;
  sessionId: string;
  /** 上行管道注入(云端任务经 stream WS);缺省 = sessionId 的本地 sender */
  sendFrame?: FrameSender;
}) {
  const { t } = useI18n();
  const [local, setLocal] = useState<"allowed" | "rejected" | null>(null);
  const [canRemember, setCanRemember] = useState(true);
  useEffect(() => {
    let alive = true;
    void engineCaps().then((caps) => {
      if (alive && caps) setCanRemember(caps.perm_remember);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (local) {
    return <span className="badge badge-ghost badge-sm self-start">{permText(local, t)}</span>;
  }

  const answer = (action: PermAction) => {
    setLocal(action === "deny" ? "rejected" : "allowed");
    void sendPermAnswerVia(sendFrame ?? localFrameSender(sessionId), perm.id, action).catch(() => setLocal(null)); // 未送达回滚,按钮恢复可点
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary btn-xs" onClick={() => answer("allow")}>
        {t("chat.perm.allow")}
      </button>
      {canRemember && (
        <>
          <button type="button" className="btn btn-xs" onClick={() => answer("always")}>
            {t("chat.perm.always")}
          </button>
          <button type="button" className="btn btn-xs" onClick={() => answer("persist")}>
            {t("chat.perm.persist")}
          </button>
        </>
      )}
      <button type="button" className="btn btn-outline btn-error btn-xs" onClick={() => answer("deny")}>
        {t("chat.perm.deny")}
      </button>
      <span className="ms-auto flex items-center gap-1 text-xs text-base-content/50">
        <kbd className="kbd kbd-xs">⏎</kbd>
        {t("chat.perm.allow")}
        <span aria-hidden> · </span>
        <kbd className="kbd kbd-xs">esc</kbd>
        {t("chat.perm.deny")}
      </span>
    </div>
  );
}

/** 独立审批卡(无锚点/找不到同 id 工具卡时渲染):警示框 + mono 原文 +
 * 按钮行;已决/过期收成一行状态(回放的审计痕迹)。
 * readonly(子会话只读回放):open 态也收成一行审计痕迹,不出按钮。 */
export function PermCard({
  item,
  sessionId,
  sendFrame,
  readonly,
}: {
  item: PermItem;
  sessionId: string;
  sendFrame?: FrameSender;
  readonly?: boolean;
}) {
  const { t, locale } = useI18n();
  // 操作正文过一遍工具词表(旧 promptCards.tsx 同款)。localizedToolTitleText
  // 连单测一起搬过来了却零调用,于是独立审批卡直接摊出 `Bash cargo test --all`;
  // 而同一应用里**有工具卡可锚定**的审批行走的是 toolDisplayName,显示「需要
  // 确认 · 执行命令」——两种审批形态语言不一致。原串退到 title 悬停(旧 UI 同款)。
  // 英文 locale 下 localizeToolTitle 原样返回,无副作用。
  const titleText = localizedToolTitleText(item.title, locale);
  if (item.state !== "open" || readonly) {
    return (
      <div role="status" className="alert alert-soft py-1.5 text-xs" data-perm-id={item.id}>
        <span className="min-w-0 flex-1 truncate" title={item.title}>
          {t("chat.permission")}
          {t("common.colon")}
          {titleText}
        </span>
        <span className="badge badge-ghost badge-xs">
          {item.state === "open" ? t("chat.perm.needConfirm") : permText(item.state, t)}
        </span>
      </div>
    );
  }
  return (
    <div role="alert" className="alert alert-warning alert-soft items-start" data-perm-id={item.id}>
      <IconHandStop size={14} stroke={1.75} aria-hidden className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span>{t("chat.perm.needConfirm")}</span>
          {item.tool && <span className="badge badge-warning badge-soft badge-xs font-mono">{item.tool}</span>}
        </div>
        <div title={item.title} className="mc-workbench-material-muted rounded-box px-3 py-2 font-mono text-xs break-all select-text">
          {titleText}
        </div>
        {/* key=perm.id:同一渲染位被复用于另一张审批卡时,乐观态(local)
            必须随卡重置,否则新卡直接顶着旧卡的"已允许"徽标出场 */}
        <PermActions key={item.id} perm={item} sessionId={sessionId} sendFrame={sendFrame} />
      </div>
    </div>
  );
}
