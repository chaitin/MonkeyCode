import { describe, expect, it } from "vitest";

import { stripWorkdir } from "./stripWorkdir";

describe("stripWorkdir", () => {
  it("剥掉正斜杠形态的工作区前缀(所有出现处)", () => {
    expect(stripWorkdir("/home/u/proj/src/main.rs", "/home/u/proj")).toBe("src/main.rs");
    expect(stripWorkdir("Edit /home/u/proj/a.ts /home/u/proj/b.ts", "/home/u/proj")).toBe("Edit a.ts b.ts");
  });

  it("剥掉反斜杠形态的工作区前缀(Windows 路径)", () => {
    expect(stripWorkdir("C:\\work\\proj\\src\\main.rs", "C:\\work\\proj")).toBe("src\\main.rs");
    // workdir 以正斜杠记录、标题却是反斜杠时同样命中
    expect(stripWorkdir("C:\\work\\proj\\src\\main.rs", "C:/work/proj")).toBe("src\\main.rs");
  });

  it("workdir 带尾随分隔符时不产生双分隔符残留", () => {
    expect(stripWorkdir("/home/u/proj/src/main.rs", "/home/u/proj/")).toBe("src/main.rs");
    expect(stripWorkdir("C:\\work\\proj\\src\\main.rs", "C:\\work\\proj\\")).toBe("src\\main.rs");
  });

  it("非前缀出现的相似路径不动", () => {
    expect(stripWorkdir("/home/u/project/src/main.rs", "/home/u/proj")).toBe("/home/u/project/src/main.rs");
    expect(stripWorkdir("Bash cargo test", "/home/u/proj")).toBe("Bash cargo test");
  });

  it("缺省 workdir 时原样返回", () => {
    expect(stripWorkdir("/home/u/proj/src/main.rs")).toBe("/home/u/proj/src/main.rs");
    expect(stripWorkdir("/home/u/proj/src/main.rs", "")).toBe("/home/u/proj/src/main.rs");
  });
});
