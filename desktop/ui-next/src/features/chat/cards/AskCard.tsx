// AI 提问卡:每题 radio(单选)/checkbox(多选)+ 可选"其他"自定义输入,
// 全部作答才可提交;提交/跳过发 reply-question(壳回推回显帧,归约置 done)。
// 已答收成只读摘要,expired 收成一行弱提示。提交先本地乐观收卡,失败回滚。
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { useI18n } from "@/lib/i18n";
import { localFrameSender, sendAskAnswersVia, sendAskCancelVia, type FrameSender } from "@/lib/ipc/approvals";
import type { AskItem, AskQuestion } from "@/lib/protocol/types";
import { createImeGuard } from "@/lib/util/slash";

/** 自定义答案在选中集合里的占位键(对齐 mobile askAnswers.ts;不上行)。 */
const CUSTOM_KEY = "__monkeycode_custom_answer__";

type Answers = Record<string, string | string[]>;

/** 已答/已跳过的只读摘要。答案是用户说的话——按用户消息形态靠右渲染
 * (chat-end 气泡,用户定案 2026-08-05),问题弱化居左;未答/跳过维持
 * 弱化卡。 */
function ReadonlyAsk({ item, local }: { item: AskItem; local: Answers | null }) {
  const { t } = useI18n();
  const answerOf = (q: AskQuestion): string => {
    const a = q.answer ?? local?.[q.question];
    return Array.isArray(a) ? a.join(t("common.listSep")) : (a ?? "");
  };
  const answered = item.questions.some((q) => answerOf(q) !== "");
  if (!answered) {
    return (
      <div role="status" className="card card-border bg-base-100">
        <div className="flex flex-col gap-2 p-3 text-xs">
          <span className="badge badge-ghost badge-xs">{t("chat.ask.unanswered")}</span>
          {item.questions.map((q, qi) => (
            <span key={qi} className="text-base-content/60">
              {q.question}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1">
      {item.questions.map((q, qi) => (
        <div key={qi} className="flex flex-col gap-0.5">
          <span className="self-start text-xs text-base-content/60">{q.question}</span>
          {answerOf(q) ? (
            <div className="chat chat-end">
              {/* 与 LogList 用户气泡同款 primary 淡染(实色太鲜艳)+ 长串可断 */}
              <div className="chat-bubble bg-primary/10 text-sm whitespace-pre-wrap wrap-anywhere select-text">
                {answerOf(q)}
              </div>
            </div>
          ) : (
            <span className="text-xs text-base-content/50">{t("chat.ask.unanswered")}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function AskCard({
  item,
  sessionId,
  sendFrame,
  readonly,
}: {
  item: AskItem;
  sessionId: string;
  /** 上行管道注入(云端任务经 stream WS);缺省 = sessionId 的本地 sender */
  sendFrame?: FrameSender;
  /** 只读回放(子会话浮层):open 态也按只读摘要渲染,不出作答表单。 */
  readonly?: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const customIme = useRef(new Map<number, ReturnType<typeof createImeGuard>>());
  const imeFor = (qi: number) => {
    let guard = customIme.current.get(qi);
    if (!guard) {
      guard = createImeGuard();
      customIme.current.set(qi, guard);
    }
    return guard;
  };
  /** 乐观提交的答案(回显帧回来前先收卡);null = 还在作答 */
  const [sent, setSent] = useState<Answers | null>(null);

  if (item.state === "expired") {
    return <div className="self-center text-xs text-base-content/50">{t("chat.ask.expired")}</div>;
  }
  if (item.state === "done" || sent || readonly) {
    return <ReadonlyAsk item={item} local={sent} />;
  }

  const pick = (qi: number, label: string, multi: boolean, checked: boolean) => {
    setSelected((prev) => {
      const cur = prev[qi] ?? [];
      const next = multi
        ? checked
          ? [...cur.filter((x) => x !== label), label]
          : cur.filter((x) => x !== label)
        : [label];
      return { ...prev, [qi]: next };
    });
    // 单选切回预设项时清掉自定义文本,避免"有输入但没勾选其他"的矛盾态
    if (!multi && label !== CUSTOM_KEY) setCustom((prev) => ({ ...prev, [qi]: "" }));
  };

  // 全部题目已作答(自定义项须有内容)才能提交;答案 {问题: 值},多选为数组
  const buildAnswers = (): Answers | null => {
    const answers: Answers = {};
    for (let qi = 0; qi < item.questions.length; qi++) {
      const q = item.questions[qi];
      if (!q) continue;
      const picks = selected[qi] ?? [];
      if (picks.length === 0) return null;
      const values: string[] = [];
      for (const p of picks) {
        if (p === CUSTOM_KEY) {
          const v = (custom[qi] ?? "").trim();
          if (!v) return null;
          values.push(v);
        } else {
          values.push(p);
        }
      }
      const first = values[0];
      if (first === undefined) return null;
      answers[q.question] = q.multiSelect ? values : first;
    }
    return answers;
  };
  const ready = buildAnswers() !== null;

  const send = sendFrame ?? localFrameSender(sessionId);
  const submit = () => {
    const answers = buildAnswers();
    if (!answers) return;
    setSent(answers);
    void sendAskAnswersVia(send, item.askId, answers).catch(() => setSent(null));
  };
  const submitOnEnter = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    if (e.target instanceof HTMLInputElement && e.target.type === "text") {
      const qi = Number(e.target.dataset.questionIndex);
      if (imeFor(qi).isImeEnter(e.timeStamp, false)) return;
    }
    e.preventDefault();
    submit();
  };
  const cancel = () => {
    setSent({});
    void sendAskCancelVia(send, item.askId).catch(() => setSent(null));
  };

  return (
    <div className="card card-border bg-base-100" onKeyDown={submitOnEnter}>
      <div className="flex flex-col gap-3 p-3">
        <div className="text-xs font-semibold">{t("chat.ask.title")}</div>
        {item.questions.map((q, qi) => {
          const picks = selected[qi] ?? [];
          return (
            <fieldset key={qi} className="flex flex-col gap-1.5">
              <legend className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                {q.header && <span className="badge badge-primary badge-soft badge-xs">{q.header}</span>}
                <span>{q.question}</span>
                {q.multiSelect && <span className="font-normal text-base-content/40">{t("chat.ask.multi")}</span>}
              </legend>
              {q.options.map((o) => (
                <label key={o.label} className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`ask-${item.askId}-${qi}`}
                    className={q.multiSelect ? "checkbox checkbox-xs" : "radio radio-xs"}
                    checked={picks.includes(o.label)}
                    onChange={(e) => pick(qi, o.label, q.multiSelect, e.target.checked)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{o.label}</span>
                    {o.description && <span className="text-base-content/50">{o.description}</span>}
                  </span>
                </label>
              ))}
              {q.custom && (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`ask-${item.askId}-${qi}`}
                    className={q.multiSelect ? "checkbox checkbox-xs" : "radio radio-xs"}
                    checked={picks.includes(CUSTOM_KEY)}
                    onChange={(e) => pick(qi, CUSTOM_KEY, q.multiSelect, e.target.checked)}
                  />
                  <span>{t("chat.ask.custom")}</span>
                </label>
              )}
              {q.custom && picks.includes(CUSTOM_KEY) && (
                <input
                  type="text"
                  aria-label={t("chat.ask.customPlaceholder")}
                  className="input input-sm w-full text-xs"
                  placeholder={t("chat.ask.customPlaceholder")}
                  value={custom[qi] ?? ""}
                  data-question-index={qi}
                  onCompositionEnd={(e) => imeFor(qi).markEnd(e.timeStamp)}
                  onChange={(e) => setCustom((prev) => ({ ...prev, [qi]: e.target.value }))}
                />
              )}
            </fieldset>
          );
        })}
        <div className="flex items-center justify-between gap-2 border-t border-base-300 pt-2">
          <button type="button" className="btn btn-ghost btn-xs" onClick={cancel}>
            {t("chat.ask.cancel")}
          </button>
          <div className="flex items-center gap-2">
            {!ready && <span className="text-xs text-base-content/40">{t("chat.ask.needAll")}</span>}
            <button type="button" className="btn btn-primary btn-sm" disabled={!ready} onClick={submit}>
              {t("chat.ask.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
