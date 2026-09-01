// 本地 composer 的状态边界。草稿、附件、上传和错误都只在这个子树更新；
// ChatView/Timeline 不再因为 textarea 每个按键重渲。
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";

import type { SessionMeta } from "@/lib/ipc/sessions";
import type { ChatState } from "@/lib/protocol/types";
import { Composer, composerPresentationOf, type ComposerInputHandle } from "./Composer";
import { useComposer } from "./useComposer";

export interface LocalComposerHandle {
  addFiles(files: File[]): Promise<void>;
  sendWithFiles(text: string, files: File[]): Promise<boolean>;
  notifyError(message: string): void;
  focus(): void;
}

export const LocalComposerHost = forwardRef<
  LocalComposerHandle,
  {
    sessionId: string;
    state: ChatState;
    historyLoaded: boolean;
    meta: SessionMeta;
    onAfterSend?: () => void;
    hotkeysActive?: boolean;
    focusRequest?: number;
    onFocusRequestHandled?: (request: number) => void;
    /** 空闲态后台状态条取材(ChatView 供给,引用稳定;透传给 Composer) */
    backgroundInfo?: {
      tasks: {
        key: string;
        title: string;
        startedAt?: number;
        childId?: string;
        agentId?: string;
        stopping?: boolean;
      }[];
      onOpen?: (childId: string) => void;
      onStop?: (agentId: string) => void;
      stopError?: string;
    };
  }
>(function LocalComposerHost(
  {
    sessionId,
    state,
    historyLoaded,
    meta,
    onAfterSend,
    hotkeysActive = true,
    focusRequest,
    onFocusRequestHandled,
    backgroundInfo,
  },
  ref,
) {
  const presentation = useMemo(() => composerPresentationOf(state), [state]);
  const ctl = useComposer(sessionId, {
    running: state.running,
    historyLoaded,
    lastSeq: state.lastSeq,
    lastTurnStartSeq: state.lastTurnStartSeq,
    lastTerminalSeq: state.lastTerminalSeq,
    steerConfirmations: presentation.steerConfirmations,
  });
  const inputRef = useRef<ComposerInputHandle>(null);

  // addFiles/notifyError 都是 useCallback，逐键草稿更新不会改变句柄；切会话
  // 时 React 会原子替换为新 ctl，上传迟到回调仍由 useComposer 纪元守卫。
  useImperativeHandle(
    ref,
    () => ({
      addFiles: ctl.addFiles,
      sendWithFiles: ctl.sendWithFiles,
      notifyError: ctl.notifyError,
      focus: () => inputRef.current?.focus(),
    }),
    [ctl.addFiles, ctl.sendWithFiles, ctl.notifyError],
  );

  return (
    <Composer
      ref={inputRef}
      sessionId={sessionId}
      presentation={presentation}
      meta={meta}
      ctl={ctl}
      onAfterSend={onAfterSend}
      hotkeysActive={hotkeysActive}
      focusRequest={focusRequest}
      onFocusRequestHandled={onFocusRequestHandled}
      backgroundInfo={backgroundInfo}
    />
  );
});
