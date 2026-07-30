// host.ts 纯判定单测:workdirMatchesEnv(新任务最近目录/默认目录按内核
// 运行环境过滤)。判错的后果是切换运行环境后预填另一环境的路径,
// session_create 必然报错。
import { describe, expect, it } from "vitest";
import { workdirMatchesEnv } from "./host";

describe("workdir 与内核运行环境匹配", () => {
  const wsl = "wsl:Ubuntu-22.04";

  it("WSL 模式放行所有可归一化形态(guest/UNC/盘符/~)", () => {
    expect(workdirMatchesEnv("/home/u/proj", wsl, true)).toBe(true);
    expect(workdirMatchesEnv("\\\\wsl$\\Ubuntu-22.04\\home\\u", wsl, true)).toBe(true);
    expect(workdirMatchesEnv("\\\\wsl.localhost\\Debian\\opt", wsl, true)).toBe(true);
    // 本机会话遗留的 Windows 路径经壳映射 /mnt 可直接用,继续预填
    expect(workdirMatchesEnv("C:\\Users\\u\\MonkeyCode", wsl, true)).toBe(true);
    expect(workdirMatchesEnv("d:/dev/x", wsl, true)).toBe(true);
    expect(workdirMatchesEnv("~/MonkeyCode", wsl, true)).toBe(true);
    // 归一化不了的形态仍滤掉
    expect(workdirMatchesEnv("relative/path", wsl, true)).toBe(false);
  });

  it("Windows 本机滤掉 guest 形态的遗留", () => {
    expect(workdirMatchesEnv("C:\\Users\\u\\MonkeyCode", "", true)).toBe(true);
    expect(workdirMatchesEnv("~/MonkeyCode", "", true)).toBe(true);
    expect(workdirMatchesEnv("/home/u/proj", "", true)).toBe(false);
    expect(workdirMatchesEnv("\\\\wsl$\\Ubuntu\\home\\u", "", true)).toBe(false);
  });

  it("macOS/Linux 本机的 / 开头是正常路径,只滤 WSL UNC", () => {
    expect(workdirMatchesEnv("/Users/u/proj", "", false)).toBe(true);
    expect(workdirMatchesEnv("~/MonkeyCode", "", false)).toBe(true);
    expect(workdirMatchesEnv("\\\\wsl$\\Ubuntu\\home\\u", "", false)).toBe(false);
  });
});
