import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import cn from "../src/i18n/resources/cn.ts"
import en from "../src/i18n/resources/en.ts"

const source = readFileSync(
  new URL("../src/components/console/task/task-long-content-dialog.tsx", import.meta.url),
  "utf8",
)

test("转换弹窗展示文件信息并在上传期间锁定操作", () => {
  assert.match(source, /export function TaskLongContentDialog/)
  assert.match(source, /characterCount/)
  assert.match(source, /filename/)
  assert.match(source, /MAX_TASK_UPLOAD_FILE_SIZE_LABEL/)
  assert.match(source, /disabled=\{converting\}/)
  assert.match(source, /if \(converting\) return/)
  assert.match(source, /void onConfirm\(\)/)
})

test("转换弹窗提供中英文资源", () => {
  assert.equal(cn.taskDetail.chat.longContent.title, "内容超出长度限制")
  assert.equal(cn.taskDetail.chat.longContent.convert, "转为 TXT 附件")
  assert.equal(cn.taskDetail.chat.longContent.converting, "正在转换并上传...")
  assert.equal(cn.taskDetail.chat.longContent.addDescription, "TXT 附件已生成，请补充说明后发送")
  assert.equal(en.taskDetail.chat.longContent.title, "Content exceeds the length limit")
  assert.equal(en.taskDetail.chat.longContent.convert, "Convert to TXT attachment")
  assert.equal(en.taskDetail.chat.longContent.converting, "Converting and uploading...")
  assert.equal(en.taskDetail.chat.longContent.addDescription, "TXT attachment created. Add a message before sending.")
})
