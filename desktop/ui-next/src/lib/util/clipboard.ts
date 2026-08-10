// 复制到剪贴板:异步 API 不可用/被拒时回退 execCommand
// (WebKitGTK 可能缺 API、WKWebView 会拒权限)。
export function copyText(text: string): void {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  };
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    clipboard.writeText(text).catch(fallback);
  } else {
    fallback();
  }
}
