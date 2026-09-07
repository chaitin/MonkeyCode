/** core-js 管不到的 Web API 兜底。plugin-legacy 注入的 polyfill 只覆盖 ECMAScript
 * 内建(数组/对象方法等),浏览器平台 API 缺了要自己补。壳内 WebView 下限见
 * vite.config.ts 的 WEBVIEW_TARGETS(Safari 14)。
 *
 * - crypto.randomUUID:Safari 15.4 才有;终端 tab、待办、云端管道、下载都拿它
 *   生成 id。用 getRandomValues 按 RFC 4122 v4 拼一个,格式与原生一致。 */
type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export function randomUuidFallback(crypto: Pick<Crypto, "getRandomValues">): Uuid {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function installWebApiPolyfills(scope: { crypto?: Crypto } = globalThis): void {
  const crypto = scope.crypto;
  if (!crypto || typeof crypto.randomUUID === "function") return;
  crypto.randomUUID = () => randomUuidFallback(crypto);
}

installWebApiPolyfills();
