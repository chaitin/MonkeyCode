// 请求分发:op → 具体实现。准入判断(checkOpAllowed)与错误码映射
// 都在纯函数层,这里只做装配,保证异常一律转成协议错误帧而非裂开。
import { attach, detach, framesList, OpError, sendCommand } from "./cdp";
import { checkOpAllowed } from "./core";
import { Op, type Request, type Response } from "./protocol";
import { getControlled, tabsActivate, tabsClose, tabsCreate, tabsList } from "./tabs";

export async function handleRequest(req: Request): Promise<Response> {
  try {
    const controlled = await getControlled();
    const denied = checkOpAllowed(req.op, req.tabId, controlled);
    if (denied) return { id: req.id, error: denied };

    switch (req.op) {
      case Op.CDP:
        return { id: req.id, result: await sendCommand(req.tabId!, req.method ?? "", req.params, req.sessionId) };
      case Op.FramesList:
        return { id: req.id, result: framesList(req.tabId!) };
      case Op.TabsCreate:
        return { id: req.id, result: await tabsCreate(req.params) };
      case Op.TabsList:
        return { id: req.id, result: await tabsList() };
      case Op.TabsActivate:
        await tabsActivate(req.tabId!);
        return { id: req.id, result: {} };
      case Op.TabsClose:
        await tabsClose(req.tabId!);
        return { id: req.id, result: {} };
      case Op.Attach:
        await attach(req.tabId!);
        return { id: req.id, result: {} };
      case Op.Detach:
        await detach(req.tabId!);
        return { id: req.id, result: {} };
      default:
        return { id: req.id, error: { code: "cdp_error", message: `未知 op: ${req.op}` } };
    }
  } catch (e) {
    if (e instanceof OpError) return { id: req.id, error: e.toResp() };
    return { id: req.id, error: { code: "cdp_error", message: e instanceof Error ? e.message : String(e) } };
  }
}
