import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const readPage = (name) =>
  readFile(new URL(`../src/pages/${name}.astro`, import.meta.url), "utf8");

describe("官网用户内容安全条款", () => {
  it("用户协议明确零容忍、举报拉黑和 24 小时处置", async () => {
    const agreement = await readPage("user-agreement");

    assert.match(agreement, /令人反感的内容和滥用用户实行零容忍/);
    assert.match(agreement, /举报涉嫌违规的消息/);
    assert.match(agreement, /拉黑后[^。]*立即从你的消息流中移除/);
    assert.match(agreement, /收到举报后 24 小时内进行审查/);
    assert.match(agreement, /删除违规内容、限制相关功能、暂停或终止违规用户账号/);
  });

  it("隐私政策说明举报和拉黑信息的收集及处理", async () => {
    const privacy = await readPage("privacy-policy");

    assert.match(privacy, /内容安全信息/);
    assert.match(privacy, /被举报内容及必要上下文/);
    assert.match(privacy, /拉黑关系/);
    assert.match(privacy, /24 小时内完成审查/);
  });
});
