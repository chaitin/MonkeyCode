// gen 类型的并行期一致性契约:ts-rs 的 export_to 仍指旧工程
// (desktop/src/driver/frame.rs → "../ui/src/gen/"),本工程持有拷贝。
// 契约更新(cargo test export_bindings 重生成)时此测试立刻变红,
// 拷贝不会静默落后。P9 切换(ui-next 改名回 ui)后本测试删除。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OLD_GEN = join(HERE, "../../../ui/src/gen");

const FILES = ["EngineStatus.ts", "Frame.ts", "PermOutcome.ts", "SessionStatus.ts"];

describe("gen 类型与旧工程逐字节一致", () => {
  it("四个 ts-rs 生成文件内容一致", () => {
    for (const name of FILES) {
      const ours = readFileSync(join(HERE, name), "utf-8");
      const theirs = readFileSync(join(OLD_GEN, name), "utf-8");
      expect(ours, `${name} 与 ui/src/gen 不一致:重新拷贝(契约以旧工程生成物为准)`).toBe(theirs);
    }
  });

  it("没有漏拷的新增生成文件", () => {
    const upstream = readdirSync(OLD_GEN).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const name of upstream) {
      expect(FILES, `旧工程 gen/ 出现新文件 ${name}:拷贝并加入 FILES`).toContain(name);
    }
  });
});
