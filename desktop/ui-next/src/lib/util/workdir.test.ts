import { describe, expect, it } from "vitest";

import { DEFAULT_DIR, workdirMatchesEnv } from "./workdir";

describe("workdirMatchesEnv(表驱动;语义 = 旧工程 host.ts)", () => {
  const cases: Array<[dir: string, kernelEnv: string, windowsShell: boolean, want: boolean]> = [
    // WSL 模式:guest posix / UNC(\\wsl$ 与 \\wsl.localhost)/ 盘符 / ~ 全放行
    ["/home/u/proj", "wsl:Ubuntu", true, true],
    ["\\\\wsl$\\Ubuntu\\home\\u\\proj", "wsl:Ubuntu", true, true],
    ["\\\\wsl.localhost\\Ubuntu\\home\\u", "wsl:Ubuntu", true, true],
    ["C:\\dev\\proj", "wsl:Ubuntu", true, true],
    ["d:/dev/proj", "wsl:Ubuntu", true, true],
    ["~/MonkeyCode", "wsl:Ubuntu", true, true],
    ["relative\\path", "wsl:Ubuntu", true, false],
    // 本机模式 + Windows 壳:posix 与 UNC 都是 WSL 遗留,滤掉
    ["/home/u/proj", "", true, false],
    ["\\\\wsl$\\Ubuntu\\home\\u", "", true, false],
    ["C:\\dev\\proj", "", true, true],
    ["~/MonkeyCode", "", true, true],
    // 本机模式 + 非 Windows 壳:/ 开头是正常路径,只滤 UNC
    ["/home/u/proj", "", false, true],
    ["\\\\wsl$\\Ubuntu\\home\\u", "", false, false],
    ["\\\\WSL.LOCALHOST\\Ubuntu\\home\\u", "", false, false],
    ["~/MonkeyCode", "", false, true],
  ];
  it.each(cases)("dir=%j env=%j win=%j → %j", (dir, kernelEnv, windowsShell, want) => {
    expect(workdirMatchesEnv(dir, kernelEnv, windowsShell)).toBe(want);
  });
});

describe("DEFAULT_DIR", () => {
  // ui-next 一度按 wsl_workdir_base 拼出 \\wsl$\<发行版>\home\<用户>\MonkeyCode
  // 当 WSL 下的默认目录,2026-08-09 撤回:落点与 `~/MonkeyCode` 完全一样(壳会把
  // UNC 再翻译回 guest 路径),却多出三笔代价——要等引擎起来才拿得到基座、
  // 拿不到时又退回 `~/MonkeyCode`(同一个"默认目录"两种形态,createDir 的判等
  // 跟着看运气)、输入框里还显示一长串 UNC。旧 UI 从头到尾就是 `~/MonkeyCode`。
  it("恒为 ~/MonkeyCode:`~` 交给壳按内核环境展开,前端不拼平台路径", () => {
    expect(DEFAULT_DIR).toBe("~/MonkeyCode");
  });

  it("它自己必须能通过所有环境的归属校验(否则默认目录会被自己过滤掉)", () => {
    for (const [env, win] of [
      ["wsl:Ubuntu", true],
      ["", true],
      ["", false],
    ] as const) {
      expect(workdirMatchesEnv(DEFAULT_DIR, env, win)).toBe(true);
    }
  });
});
