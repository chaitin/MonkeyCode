// 桌面壳自绘右键菜单:WebView 原生菜单固定带"检查元素/重新加载"等浏览器项,
// 三端平台 API 都裁不掉单项,壳内右键一律拦截(main.tsx),文本复制/粘贴
// 在这里自绘。样式复用 .pop / .hv menu-item;非壳环境不会走到这里。
import { copyText } from "./markdown";

type Editable = HTMLInputElement | HTMLTextAreaElement;

// number 等类型的 selectionStart API 不可用,按无编辑菜单处理
const TEXT_INPUT = /^(text|password|search|url|tel|email)$/;

function editableTarget(t: Element | null): Editable | null {
  const el = t?.closest("input, textarea");
  if (el instanceof HTMLInputElement) return TEXT_INPUT.test(el.type) ? el : null;
  return el instanceof HTMLTextAreaElement ? el : null;
}

function fieldSelection(el: Editable): string {
  return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
}

/** 焦点回到输入框后用 insertText 替换选区:走真实输入事件,React 受控组件能收到 */
function replaceSelection(el: Editable, text: string) {
  el.focus();
  document.execCommand("insertText", false, text);
}

function paste(el: Editable) {
  const legacy = () => {
    el.focus();
    document.execCommand("paste"); // WebKitGTK 缺 readText / WKWebView 权限被拒时的兜底
  };
  if (!navigator.clipboard?.readText) return legacy();
  navigator.clipboard.readText().then((text) => {
    if (text) replaceSelection(el, text);
  }, legacy);
}

interface Item {
  label: string;
  run: () => void;
}

function buildItems(e: MouseEvent): Item[] {
  const field = editableTarget(e.target instanceof Element ? e.target : null);
  if (field) {
    const sel = fieldSelection(field);
    const writable = !field.readOnly && !field.disabled;
    // 密码框与系统菜单一致:选区内容不外流(无剪切/复制)
    const secret = field instanceof HTMLInputElement && field.type === "password";
    const items: Item[] = [];
    if (sel && !secret) {
      if (writable) items.push({ label: "剪切", run: () => { copyText(sel); replaceSelection(field, ""); } });
      items.push({ label: "复制", run: () => copyText(sel) });
    }
    if (writable) items.push({ label: "粘贴", run: () => paste(field) });
    items.push({ label: "全选", run: () => { field.focus(); field.select(); } });
    return items;
  }
  const sel = window.getSelection()?.toString();
  return sel ? [{ label: "复制", run: () => copyText(sel) }] : [];
}

let cleanup: (() => void) | null = null;

function closeMenu() {
  cleanup?.();
}

/** 在右键位置弹出文本操作菜单;无可操作项(纯 chrome 区域)则什么都不弹。 */
export function openTextContextMenu(e: MouseEvent) {
  closeMenu();
  const items = buildItems(e);
  if (!items.length) return;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const menu = document.createElement("div");
  menu.className = "pop";
  menu.style.position = "fixed";
  menu.style.minWidth = "120px";
  for (const it of items) {
    const btn = document.createElement("button");
    btn.className = "hv menu-item";
    btn.textContent = it.label;
    // mousedown 默认会把焦点从输入框抢走,选区一丢 execCommand 就没得操作了
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    btn.addEventListener("click", () => {
      closeMenu();
      it.run();
    });
    menu.appendChild(btn);
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closeMenu();
  };
  backdrop.addEventListener("mousedown", closeMenu);
  backdrop.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    closeMenu();
  });
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
  cleanup = () => {
    cleanup = null;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", closeMenu);
    window.removeEventListener("blur", closeMenu);
    backdrop.remove();
    menu.remove();
  };
  document.body.append(backdrop, menu);
  // 先挂载量出尺寸再定位:贴视口边缘时往回收
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(e.clientX, window.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY, window.innerHeight - r.height - 8))}px`;
}
