import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
)

test("输入框编排超长文本转换状态", () => {
  assert.match(source, /hasCrossedTaskContentLimit\(content\.length, nextContent\.length, MAX_TASK_CONTENT_LENGTH\)/)
  assert.match(source, /setLongContentPromptPending\(true\)/)
  assert.match(source, /if \(contentLength <= MAX_TASK_CONTENT_LENGTH\)/)
  assert.match(source, /if \(!longContentPromptPending \|\| isComposing \|\| !canUseIdleControls\)/)
  assert.match(source, /openLongContentDialog\(\)/)
  assert.match(source, /setLongContentPromptSuppressed\(true\)/)
})

test("确认转换复用上传链路并保护失败原文", () => {
  assert.match(source, /createLongContentTextFile\(longContentDraft\.content, longContentDraft\.filename\)/)
  assert.match(source, /await uploadTaskFile\(file\)/)
  assert.match(source, /handleUploaded\(uploadedFile\)/)
  assert.match(source, /removeTaskInputDraft\(taskId\)/)
  assert.match(source, /setContent\(''\)/)
  assert.match(source, /error instanceof TaskUploadFileTooLargeError/)
  assert.match(source, /taskDetail\.chat\.longContent\.convertFailed/)
})

test("超限提示提供手动转换入口并渲染确认弹窗", () => {
  assert.match(source, /taskDetail\.chat\.longContent\.manualConvert/)
  assert.match(source, /<TaskLongContentDialog/)
  assert.match(source, /characterCount=\{longContentDraft\?\.content\.length \?\? contentLength\}/)
  assert.match(source, /converting=\{longContentConverting\}/)
})
