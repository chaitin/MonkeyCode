import assert from "node:assert/strict"
import test from "node:test"
import {
  conversationQuery,
  conversationResult,
} from "../src/lib/conversation-history.ts"

test("轮次结束原因区分完成、中断、失败、达到上限和未知", () => {
  assert.equal(conversationResult("complete"), "completed")
  assert.equal(conversationResult("interrupted"), "interrupted")
  assert.equal(conversationResult("error"), "failed")
  assert.equal(conversationResult("max_turns"), "incomplete")
  assert.equal(conversationResult("output_limit"), "incomplete")
  assert.equal(conversationResult("unknown"), "unknown")
})

test("搜索参数保留百分号、下划线、中文及正文特殊字符", () => {
  const id = "00000000-0000-4000-8000-000000000001"
  const query = new URLSearchParams(
    conversationQuery(
      {
        taskName: "  报告 100%_  ",
        taskId: ` ${id} `,
        user: "  USER@example.com  ",
        content: "  正文 a&b=100%_ + 后续  ",
        from: "2026-09-08T00:00:00+08:00",
        until: "2026-09-09T00:00:00+08:00",
      },
      2,
      50
    )
  )
  assert.equal(query.get("task"), "报告 100%_")
  assert.equal(query.get("task_id"), id)
  assert.equal(query.get("user"), "USER@example.com")
  assert.equal(query.get("content"), "正文 a&b=100%_ + 后续")
  assert.equal(query.get("from"), "2026-09-08T00:00:00+08:00")
  assert.equal(query.get("until"), "2026-09-09T00:00:00+08:00")
  assert.equal(query.get("page"), "2")
  assert.equal(query.get("page_size"), "50")
})

test("未选择日期时不隐式限制历史范围，按任务 ID 进入保持精确筛选", () => {
  const id = "00000000-0000-4000-8000-000000000001"
  const query = new URLSearchParams(
    conversationQuery({ taskName: "", taskId: id, user: " ", content: "" }, 1, 10)
  )
  assert.equal(query.get("task_id"), id)
  assert.equal(query.has("from"), false)
  assert.equal(query.has("until"), false)
  assert.equal(query.has("user"), false)
  assert.equal(query.has("task"), false)
  assert.equal(query.has("content"), false)
})
