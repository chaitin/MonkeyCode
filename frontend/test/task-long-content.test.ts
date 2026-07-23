import assert from "node:assert/strict"
import test from "node:test"

import {
  createLongContentFileName,
  createLongContentTextFile,
  hasCrossedTaskContentLimit,
  mergeLongContentFollowUp,
} from "../src/components/console/task/task-long-content.ts"

test("仅在内容首次跨越字符上限时触发", () => {
  assert.equal(hasCrossedTaskContentLimit(9999, 10000, 10000), false)
  assert.equal(hasCrossedTaskContentLimit(10000, 10001, 10000), true)
  assert.equal(hasCrossedTaskContentLimit(10001, 10002, 10000), false)
  assert.equal(hasCrossedTaskContentLimit(10001, 10000, 10000), false)
})

test("使用 UTC 时间生成稳定的 TXT 文件名", () => {
  const date = new Date("2026-07-17T15:30:45.123Z")
  assert.equal(createLongContentFileName(date), "long-input-20260717-153045.txt")
})

test("创建保留中文 Emoji 和换行的 UTF-8 TXT 文件", async () => {
  const content = "需求说明\n你好，MonkeyCode。\nEmoji: 🚀"
  const file = createLongContentTextFile(content, "long-input-20260717-153045.txt", 123)

  assert.equal(file.name, "long-input-20260717-153045.txt")
  assert.equal(file.type, "text/plain;charset=utf-8")
  assert.equal(file.lastModified, 123)
  assert.equal(await file.text(), content)
  assert.equal(file.size, new TextEncoder().encode(content).byteLength)
})

test("合并转换期间更新的正文与延迟语音", () => {
  assert.equal(mergeLongContentFollowUp("", null), "")
  assert.equal(mergeLongContentFollowUp("", "语音说明"), "语音说明")
  assert.equal(mergeLongContentFollowUp("已更新正文", null), "已更新正文")
  assert.equal(mergeLongContentFollowUp("已更新正文", "语音说明"), "已更新正文\n语音说明")
  assert.equal(mergeLongContentFollowUp("已更新正文\n", "语音说明"), "已更新正文\n语音说明")
})
