// 桌面壳自绘右键菜单:WebView 原生菜单固定带"检查元素/重新加载"等浏览器
// 项且三端 API 都裁不掉,壳内右键一律拦截(app/shellChrome),文本操作与本地
// 图片复制都在这里命令式自绘(daisyUI menu 皮相,类名为源码字面量)。
// 关键行为:菜单按钮 mousedown preventDefault(不抢输入框焦点,选区不丢);
// 受控组件经 execCommand insertText 改值(走真实输入事件 React 能收到);
// 密码框与系统菜单一致不给剪切/复制;贴视口边缘回收定位。
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/util/clipboard";
import { pushEscLayer } from "@/lib/util/escLayer";

type Editable = HTMLInputElement | HTMLTextAreaElement;

// number 等类型的 selectionStart API 不可用,按无编辑菜单处理
const TEXT_INPUT = /^(text|password|search|url|tel|email)$/;

function editableTarget(target: Element | null): Editable | null {
  const el = target?.closest("input, textarea");
  if (el instanceof HTMLInputElement) return TEXT_INPUT.test(el.type) ? el : null;
  return el instanceof HTMLTextAreaElement ? el : null;
}

function fieldSelection(el: Editable): string {
  return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
}

/** 焦点回到输入框后用 insertText 替换选区:走真实输入事件,受控组件能收到。 */
function replaceSelection(el: Editable, text: string) {
  el.focus();
  document.execCommand("insertText", false, text);
}

function paste(el: Editable) {
  const legacy = () => {
    el.focus();
    document.execCommand("paste"); // WebKitGTK 缺 readText / WKWebView 权限被拒时的兜底
  };
  const clipboard = navigator.clipboard;
  if (!clipboard?.readText) return legacy();
  clipboard.readText().then((text) => {
    if (text) replaceSelection(el, text);
  }, legacy);
}

function copyableImage(target: Element | null): HTMLImageElement | null {
  const image = target?.closest("img");
  if (!(image instanceof HTMLImageElement)) return null;
  const src = image.currentSrc || image.src;
  // 工具产图经 upload_read 回读为 data URL；blob 同样不会污染 canvas。
  // 跨域 http(s) 图片画入 canvas 后会触发安全错误，不提供一个必失败的入口。
  return src.startsWith("data:") || src.startsWith("blob:") ? image : null;
}

const COPY_CANVAS_MAX_DIMENSION = 8192;
const COPY_CANVAS_MAX_PIXELS = 16 * 1024 * 1024;

function copyCanvasSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(
    1,
    COPY_CANVAS_MAX_DIMENSION / width,
    COPY_CANVAS_MAX_DIMENSION / height,
    Math.sqrt(COPY_CANVAS_MAX_PIXELS / width / height),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function imagePngBlob(image: HTMLImageElement): Promise<Blob> {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("Image has no size");
  // 统一压在各端 WebView 都可编码的范围内；尤其 full_page 截图可能极长，
  // 文件虽不到 20MB，原尺寸 canvas 仍会超过维度上限或制造过高内存峰值。
  const size = copyCanvasSize(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  // async 函数会把损坏/未解码图片的同步 InvalidStateError 收进拒绝链，最终由
  // clipboard.write().catch 消化，不能逃到全局错误面板。
  context.drawImage(image, 0, 0, size.width, size.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png");
  });
}

function copyImage(image: HTMLImageElement): void {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return;
  // write 必须留在点击手势内同步调用；ClipboardItem 接受 Promise<Blob>，编码
  // 可以异步完成（与 Mermaid 图片复制保持同一条兼容路径）。
  const item = new ClipboardItem({ "image/png": imagePngBlob(image) });
  navigator.clipboard.write([item]).catch(() => {});
}

export interface MenuItem {
  label: string;
  run: () => void;
  /** 危险动作红字 */
  danger?: boolean;
  /** 二段确认:第一次点换成此文案,再点才执行 */
  confirm?: string;
  /** 不可用的**原因**(非布尔):置灰 + 进 title。禁用态不给理由,用户只会
   *  以为界面坏了——「运行中,请先停止」这类话必须能表达出来(旧 UI 同款)。 */
  disabledReason?: string;
}

function buildItems(e: MouseEvent): MenuItem[] {
  const target = e.target instanceof Element ? e.target : null;
  const image = copyableImage(target);
  if (image) {
    const copySupported = typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);
    const items: MenuItem[] = [
      {
        label: t("ctx.copyImage"),
        run: () => copyImage(image),
        disabledReason: copySupported ? undefined : t("ctx.copyImageUnsupported"),
      },
    ];
    const sel = window.getSelection()?.toString();
    if (sel) items.push({ label: t("ctx.copy"), run: () => copyText(sel) });
    return items;
  }
  const field = editableTarget(target);
  if (field) {
    const sel = fieldSelection(field);
    const writable = !field.readOnly && !field.disabled;
    // 密码框与系统菜单一致:选区内容不外流(无剪切/复制)
    const secret = field instanceof HTMLInputElement && field.type === "password";
    const items: MenuItem[] = [];
    if (sel && !secret) {
      if (writable)
        items.push({
          label: t("ctx.cut"),
          run: () => {
            copyText(sel);
            replaceSelection(field, "");
          },
        });
      items.push({ label: t("ctx.copy"), run: () => copyText(sel) });
    }
    if (writable) items.push({ label: t("ctx.paste"), run: () => paste(field) });
    items.push({
      label: t("ctx.selectAll"),
      run: () => {
        field.focus();
        field.select();
      },
    });
    return items;
  }
  const sel = window.getSelection()?.toString();
  return sel ? [{ label: t("ctx.copy"), run: () => copyText(sel) }] : [];
}

let cleanup: (() => void) | null = null;

function closeMenu() {
  const cb = currentOnClose;
  currentOnClose = null;
  cleanup?.();
  cb?.();
}

/** 在任意位置弹命令式菜单(行右键等场景与文本菜单共用同一套机制)。 */
let currentOnClose: (() => void) | null = null;

export function openMenu(pos: { x: number; y: number }, items: MenuItem[], opts?: { onClose?: () => void }): void {
  closeMenu();
  if (!items.length) return;
  currentOnClose = opts?.onClose ?? null;

  const backdrop = document.createElement("div");
  // daisyUI modal 写死 z-index:999；命令式菜单追加到 body，必须进入统一窗口
  // 覆盖层(1000)，否则在 portal 弹窗/子会话回放里会沉到 modal 下面。
  backdrop.className = "fixed inset-0 z-[var(--z-window-overlay)]";
  const menu = document.createElement("ul");
  // [&_li]:flex-nowrap:§6.2 截断铁律(.menu li 默认 column wrap,行宽跟
  // 内容走,truncate 不触发);字面量与 tsx 侧一致,Tailwind 扫源码可生成
  menu.className =
    "menu bg-base-100 rounded-box fixed z-[var(--z-window-overlay)] w-36 flex-nowrap [&_li]:flex-nowrap shadow-sm";
  for (const it of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = it.label;
    if (it.danger) btn.classList.add("text-error");
    // mousedown 默认会把焦点从输入框抢走,选区一丢 execCommand 就没得操作了
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    if (it.disabledReason) {
      // daisyUI menu 的官方禁用形态挂在 li 上;理由进 title(见 MenuItem 注释)
      li.classList.add("menu-disabled");
      btn.disabled = true;
      btn.title = it.disabledReason;
      li.appendChild(btn);
      menu.appendChild(li);
      continue;
    }
    let armed = !it.confirm;
    btn.addEventListener("click", () => {
      // 危险动作二段确认:第一次点只换文案,菜单不关
      if (!armed) {
        armed = true;
        btn.textContent = it.confirm ?? it.label;
        return;
      }
      closeMenu();
      it.run();
    });
    li.appendChild(btn);
    menu.appendChild(li);
  }

  backdrop.addEventListener("mousedown", closeMenu);
  backdrop.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    closeMenu();
  });
  // Esc 走统一层栈(escLayer):命令式菜单是最后打开的,自然在栈顶先拿到
  const popEsc = pushEscLayer(() => {
    closeMenu();
    return true;
  });
  window.addEventListener("resize", closeMenu);
  window.addEventListener("blur", closeMenu);
  cleanup = () => {
    cleanup = null;
    popEsc();
    window.removeEventListener("resize", closeMenu);
    window.removeEventListener("blur", closeMenu);
    backdrop.remove();
    menu.remove();
  };
  document.body.append(backdrop, menu);
  // 先挂载量出尺寸再定位:贴视口边缘时往回收
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(pos.x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(0, Math.min(pos.y, window.innerHeight - rect.height - 8))}px`;
}

/** 在右键位置弹壳内操作菜单；无可操作项(纯 chrome 区域)则什么都不弹。 */
export function openContextMenu(e: MouseEvent): void {
  openMenu({ x: e.clientX, y: e.clientY }, buildItems(e));
}
