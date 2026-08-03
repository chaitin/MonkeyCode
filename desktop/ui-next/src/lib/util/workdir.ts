// 工作目录 × 内核运行环境的纯函数(旧工程 host.ts::workdirMatchesEnv 语义
// 重写)。无 IPC、无 DOM;新任务面的"最近目录过滤 / 默认目录推导"共用。

/** 默认工作目录,**所有平台与运行环境同一个值**:`~` 由壳按当前内核环境展开
 *  ——WSL 模式展开成 guest 家目录(driver/session.rs::resolve_wsl_workdir),
 *  本机模式展开成宿主主目录(config::expand_tilde)。createDir 语义下静默创建。
 *
 *  别再拿 wsl_workdir_base 去拼一个 `\\wsl$\<发行版>\home\<用户>\MonkeyCode`
 *  (ui-next 一度这么干,2026-08-09 撤回,旧 UI 从来就是 `~/MonkeyCode`):
 *  ①落点完全一样,壳只是把 UNC 再翻译回 guest 路径,白绕一圈;
 *  ②那个基座要引擎起来才拿得到(prepare 时采集),引擎没就绪就退回
 *    `~/MonkeyCode`——同一个"默认目录"两种形态,createDir 的
 *    `workdir === defaultDir` 判等还得跟着看运气;
 *  ③输入框里显示一长串 UNC,不如 `~/MonkeyCode` 一眼看得懂在哪。
 *  目录**对话框**的起始位置仍要真实路径,那条继续走 host.ts::workdirPickBase。 */
export const DEFAULT_DIR = "~/MonkeyCode";

/** 目录是否属于当前内核运行环境。WSL 模式下 guest 形态(/… 或 \\wsl$ UNC)、
 * Windows 盘符(壳映射为 /mnt/<盘>/…)与 ~ 形态(展开为 guest 家目录)均可
 * 归一化,全放行;本机模式下 guest 形态是 WSL 会话的遗留——Windows 壳上
 * 滤掉(macOS/Linux 本机的 / 开头是正常路径,只滤 UNC)。新任务的"最近
 * 目录/默认目录"按此过滤,切换运行环境后不再预填一个必然失败的路径。 */
export function workdirMatchesEnv(dir: string, kernelEnv: string, windowsShell: boolean): boolean {
  const wsl = kernelEnv.startsWith("wsl:");
  const posix = dir.startsWith("/");
  const unc = /^\\\\wsl(\$|\.localhost)\\/i.test(dir);
  if (wsl) return posix || unc || /^[a-zA-Z]:[\\/]/.test(dir) || dir.startsWith("~");
  return windowsShell ? !posix && !unc : !unc;
}
