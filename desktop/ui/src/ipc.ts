// 壳连接层 IPC 原语:UI 只经 Tauri IPC 与桌面壳对话(invoke 上行 + event
// 下行),壳内 driver 适配 agent 引擎;帧载荷编解码在 codec.ts(纯函数,
// node 单测可导入)。按域拆分:本地会话 session.ts / 附件 uploads.ts /
// 百智云账号 baizhiapi.ts / MonkeyCode 云端 REST+WS cloudapi.ts / 宿主集成
// host.ts,均经本层收发;导出签名与旧 HTTP/WS 版本保持一致,视图层零改动。
//
// 事件通道(壳 → UI):
//   frames:{sid}       Frame[](批量;本地会话流,壳侧 ~30ms 聚合)
//   conn-status:{sid}  {text, connected} 会话流连接状态
//   session-event      {type: session-status|session-ask|session-summary, ...}
//                      全局会话状态与摘要更新
//   ws-msg:{pipe}      云端 WS 桥下行文本帧(stream/control/terminal 协议不变)
//   ws-closed:{pipe}   云端 WS 桥断开
//   engine-status      引擎生命周期状态(契约 6:stopped/starting/ready/
//                      crashed/failed);快照另有 engine_status 命令可补拉
//   open-settings / open-session   托盘、桌宠等壳侧入口的导航意图
//   browser-mcp-reloaded           配对后引擎已带新工具集(UI 整页刷新)
//   browser-mcp-refresh-timeout    等任务空闲超时放弃刷新(提示手动重启)

interface TauriGlobal {
  core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  event?: {
    listen?: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
  /** 系统路径命名空间(withGlobalTauri 全量注入;保存对话框拼默认目录用) */
  path?: {
    downloadDir?: () => Promise<string>;
    join?: (...paths: string[]) => Promise<string>;
  };
}

export function tauri(): TauriGlobal | undefined {
  // node 测试环境(react-dom/server 渲染)没有 window:按非壳环境处理
  if (typeof window === "undefined") return undefined;
  return (window as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** invoke 封装:非壳环境(纯浏览器打开构建产物)直接报错。 */
export function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  const inv = tauri()?.core?.invoke;
  if (!inv) return Promise.reject(new Error("非桌面壳环境"));
  return inv(cmd, args) as Promise<T>;
}

/** 订阅壳事件;返回退订函数。listen 的注册是异步的,退订经 promise 链兜底。 */
export function listen(name: string, cb: (payload: unknown) => void): () => void {
  const l = tauri()?.event?.listen;
  if (!l) return () => {};
  const un = l(name, (e) => cb(e.payload));
  return () => {
    un.then((f) => f()).catch(() => {});
  };
}

/** 等注册完成的订阅:壳在命令处理中同步 emit 的事件(会话回放、管道首帧)
 * 必须在监听注册落地后才发起命令,否则事件被丢不排队。 */
export async function listenAsync(name: string, cb: (payload: unknown) => void): Promise<() => void> {
  const l = tauri()?.event?.listen;
  if (!l) throw new Error("非桌面壳环境");
  return l(name, (e) => cb(e.payload));
}
