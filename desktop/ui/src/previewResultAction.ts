import type { PreviewResultAction } from "./host";

export type PreviewResultHandlers = Record<PreviewResultAction, () => void | Promise<void>>;

/** Routes the strictly typed host event to one action handler. */
export async function dispatchPreviewResultAction(
  action: PreviewResultAction,
  handlers: PreviewResultHandlers,
): Promise<void> {
  await handlers[action]();
}
