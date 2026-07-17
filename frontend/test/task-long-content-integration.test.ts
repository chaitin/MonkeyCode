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
  assert.match(source, /if \(!handleUploaded\(uploadedFile\)\)/)
  assert.match(source, /removeTaskInputDraft\(taskId\)/)
  assert.match(source, /setContent\(''\)/)
  assert.match(source, /error instanceof TaskUploadFileTooLargeError/)
  assert.match(source, /taskDetail\.chat\.longContent\.convertFailed/)
})

test("StrictMode 生命周期与附件竞争保持转换状态安全", () => {
  assert.match(source, /React\.useEffect\(\(\) => \{\s+mountedRef\.current = true\s+return \(\) => \{\s+mountedRef\.current = false/)
  assert.match(source, /const uploadedFilesRef = useRef\(uploadedFiles\)/)
  assert.match(source, /if \(uploadedFilesRef\.current\.length >= MAX_UPLOADED_FILES\)/)
})

test("所有用户正文更新入口统一执行越界检测", () => {
  assert.match(source, /const handleTextRecognized = \(text: string\) => \{[\s\S]+?selectedQuickInputRef\.current = null\s+handleContentChange\(text\)/)
  assert.match(source, /selectedQuickInputRef\.current = normalizedText\s+handleContentChange\(normalizedText\)/)
  assert.match(source, /const nextContent = `[^`]+`\s+handleContentChange\(nextContent\)/)
})

test("转换期间延迟语音结果并避免覆盖更新后的正文", () => {
  assert.match(source, /const deferredRecognizedTextRef = useRef<string \| null>\(null\)/)
  assert.match(source, /if \(longContentDraft \|\| longContentConverting\) \{\s+deferredRecognizedTextRef\.current = text/)
  assert.match(source, /contentRef\.current === conversionContent/)
  assert.match(source, /mergeLongContentFollowUp\(currentContent, deferredRecognizedText\)/)
  assert.match(source, /appendDeferredRecognizedText\(longContentDraft\.content\)/)
})

test("超限提示提供手动转换入口并渲染确认弹窗", () => {
  assert.match(source, /taskDetail\.chat\.longContent\.manualConvert/)
  assert.match(source, /<TaskLongContentDialog/)
  assert.match(source, /characterCount=\{longContentDraft\?\.content\.length \?\? contentLength\}/)
  assert.match(source, /converting=\{longContentConverting\}/)
})
