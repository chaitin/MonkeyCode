export type PreviewCaptureState = {
  requestId: string;
  dataUrl?: string;
  purpose: "screenshot" | "mark";
};

export type PreviewCaptureAction =
  | { type: "captured"; requestId: string; dataUrl: string }
  | { type: "cancel" | "timeout" | "error"; requestId: string };

/** Request-aware transitions ensure late native events cannot revive a cancelled capture. */
export function transitionPreviewCapture(
  current: PreviewCaptureState | null,
  action: PreviewCaptureAction,
): PreviewCaptureState | null {
  if (!current || current.requestId !== action.requestId) return current;
  return action.type === "captured" ? { ...current, dataUrl: action.dataUrl } : null;
}

export const previewCapturePending = (capture: PreviewCaptureState | null): boolean =>
  !!capture && !capture.dataUrl;

export const previewCaptureButtonDisabled = (
  shell: boolean,
  listenersReady: boolean,
  capture: PreviewCaptureState | null,
): boolean => !shell || !listenersReady || !!capture;

export const previewNativeShouldHide = (capture: PreviewCaptureState | null): boolean =>
  !!capture?.dataUrl;
