// 文件类型图标映射:整名优先、扩展名兜底、未知回落中性件。
// 断言比图标**引用**而非 displayName:图标库可能把多个名字映到同一组件,
// 且 displayName 随上游改名会假失败——比引用两者都不受影响。
import { IconDatabase, IconFile, IconFileCertificate, IconFileCode, IconFileSettings, IconFileText, IconFileZip, IconBraces, IconPhoto, IconScript } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";

import { fileIconOf } from "./fileIcon";

const iconOf = (f: string) => fileIconOf(f).icon;

describe("fileIconOf", () => {
  it("按扩展名分型(代码/数据/媒体/脚本/归档),大小写与路径前缀不影响", () => {
    expect(iconOf("src/App.TSX")).toBe(IconFileCode);
    expect(iconOf("tsconfig.json")).toBe(IconBraces);
    expect(iconOf("logo.PNG")).toBe(IconPhoto);
    expect(iconOf("build.sh")).toBe(IconScript);
    expect(iconOf("dist.tar.gz")).toBe(IconFileZip);
    expect(iconOf("schema.sql")).toBe(IconDatabase);
  });

  it("整名优先于扩展名:锁文件不算 json/yaml", () => {
    expect(iconOf("package-lock.json")).toBe(IconFileCertificate);
    expect(iconOf("pnpm-lock.yaml")).toBe(IconFileCertificate);
    expect(iconOf("Cargo.lock")).toBe(IconFileCertificate);
    expect(iconOf("package.json")).toBe(IconBraces); // 对照:普通文件仍按扩展名走
  });

  it("无扩展名/隐藏文件:知名的给配置件,其余回落中性 IconFile", () => {
    expect(iconOf("Dockerfile")).toBe(IconFileSettings);
    expect(iconOf(".gitignore")).toBe(IconFileSettings);
    expect(iconOf(".unknownrc")).toBe(IconFile); // 前导点不当扩展名解析
    expect(iconOf("LICENSE")).toBe(IconFileText);
    expect(iconOf("mystery")).toBe(IconFile);
  });

  it("色调一律是完整 Tailwind 类字面量(禁拼接,静态扫描要求)", () => {
    for (const f of ["a.ts", "b.json", "c.png", "d.sh", "e.unknown"]) {
      expect(fileIconOf(f).tone).toMatch(/^text-[a-z0-9/-]+$/);
    }
  });
});
