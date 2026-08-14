import { getBackground } from "./ipc/config";
import { getBackgroundId, setBackgroundId } from "./theme";

const BACKGROUND_TRANSPARENCY_KEY = "mc.backgroundTransparency";

/**
 * 主内容阅读层的透明度（0=不透明，100=完全透明）。
 * 保存的值是用户看到的「透明度」；CSS 变量则是反向的阅读层不透明度。
 */
export function getBackgroundTransparency(): number {
  const value = Number(localStorage.getItem(BACKGROUND_TRANSPARENCY_KEY));
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
}

export function setBackgroundTransparency(transparency: number): number {
  const next = Math.min(100, Math.max(0, Math.round(transparency)));
  localStorage.setItem(BACKGROUND_TRANSPARENCY_KEY, String(next));
  document.documentElement.style.setProperty("--mc-main-surface-opacity", `${100 - next}%`);
  return next;
}

/** Apply the persisted setting before views are mounted, preventing a visible reset on startup. */
export function restoreBackgroundTransparency(): void {
  setBackgroundTransparency(getBackgroundTransparency());
}

function removeLegacyInlineBackgroundImage(): void {
  const style = document.documentElement.style;
  // A legacy `background: url(...) ...` shorthand also owns background-image,
  // so remove that shorthand only when it actually contains an image.
  if (style.getPropertyValue("background-image") && style.backgroundImage !== "none") {
    style.removeProperty("background");
  }
  style.removeProperty("background-image");
}

/**
 * Remove both the current CSS-variable background and the legacy inline property.
 * Older builds wrote `style.backgroundImage`; that inline declaration has higher
 * priority than app.css and otherwise prevents a restored background from showing.
 */
export function clearAppliedBackground(): void {
  document.documentElement.style.removeProperty("--mc-background-image");
  removeLegacyInlineBackgroundImage();
}

/**
 * Restore the persisted image. `false` means the image could not be read now;
 * callers may show an error or retry later while retaining the saved id.
 */
export async function restoreBackground(): Promise<boolean> {
  const id = getBackgroundId();
  if (!id) {
    clearAppliedBackground();
    return true;
  }

  try {
    const url = await getBackground(id);
    if (!url) {
      setBackgroundId(null);
      clearAppliedBackground();
      return false;
    }

    // Clear legacy inline image before applying the CSS variable used by app.css.
    removeLegacyInlineBackgroundImage();
    document.documentElement.style.setProperty("--mc-background-image", `url(${url})`);
    return true;
  } catch {
    // Keep the id so a temporary IPC failure can be retried later.
    return false;
  }
}
