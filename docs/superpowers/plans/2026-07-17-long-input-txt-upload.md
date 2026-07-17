# 对话超长文本转 TXT 附件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在任务详情对话输入框中检测超过 10000 字的文本，经用户确认后将完整内容上传为 TXT 附件，并保留补充说明后发送的现有规则。

**Architecture:** `task-long-content.ts` 提供可独立测试的越界判断、时间命名和 UTF-8 文件创建函数，`task-long-content-dialog.tsx` 负责确认界面，`chat-inputbox.tsx` 只编排待提示、取消抑制、异步上传和附件状态。上传继续调用 `uploadTaskFile()`，后端接口和非空文本校验保持现状。

**Tech Stack:** React 19、TypeScript 5.9、Tailwind CSS 4、i18next、Node.js Test Runner、Vite 7

## Global Constraints

- 首期仅覆盖任务详情对话输入框 `TaskChatInputBox`。
- 字符上限保持 `MAX_TASK_CONTENT_LENGTH = 10000`，长度计算沿用 JavaScript `string.length`。
- TXT 文件名固定使用 `long-input-YYYYMMDD-HHmmss.txt` UTC 时间格式。
- TXT MIME 类型使用 `text/plain;charset=utf-8`。
- 用户需要补充非空说明文字后才能发送，前后端消息校验保持现状。
- 继续使用最多 3 个附件和单文件 2MB 限制。
- 取消、上传失败、附件已满和文件过大时完整保留输入内容。
- 任务执行期间记录待提示状态，恢复空闲后使用最新完整文本弹窗。
- 保持现有文件选择、文件粘贴、拖拽上传、画板附件、队列发送和草稿恢复行为。
- 新增界面文案必须同时提供简体中文和英文资源。
- 每个功能任务遵循 TDD，并使用独立中文提交。

---

### Task 1: 超长文本纯函数

**Files:**
- Create: `frontend/src/components/console/task/task-long-content.ts`
- Create: `frontend/test/task-long-content.test.ts`

**Interfaces:**
- Consumes: `previousLength: number`、`nextLength: number`、`maxLength: number`、`Date`、完整文本和目标文件名。
- Produces: `hasCrossedTaskContentLimit(previousLength, nextLength, maxLength): boolean`。
- Produces: `createLongContentFileName(date: Date): string`。
- Produces: `createLongContentTextFile(content: string, filename: string, lastModified?: number): File`。

- [ ] **Step 1: 编写失败的纯函数测试**

创建 `frontend/test/task-long-content.test.ts`：

```ts
import assert from "node:assert/strict"
import test from "node:test"

import {
  createLongContentFileName,
  createLongContentTextFile,
  hasCrossedTaskContentLimit,
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
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
cd frontend
tsx --test test/task-long-content.test.ts
```

Expected: FAIL，提示无法解析 `task-long-content.ts`。

- [ ] **Step 3: 实现最小纯函数模块**

创建 `frontend/src/components/console/task/task-long-content.ts`：

```ts
export const hasCrossedTaskContentLimit = (
  previousLength: number,
  nextLength: number,
  maxLength: number,
) => previousLength <= maxLength && nextLength > maxLength

export const createLongContentFileName = (date: Date) => {
  const iso = date.toISOString()
  const day = iso.slice(0, 10).replaceAll("-", "")
  const time = iso.slice(11, 19).replaceAll(":", "")
  return `long-input-${day}-${time}.txt`
}

export const createLongContentTextFile = (
  content: string,
  filename: string,
  lastModified = Date.now(),
) => new File([content], filename, {
  type: "text/plain;charset=utf-8",
  lastModified,
})
```

- [ ] **Step 4: 运行专项测试并确认通过**

Run:

```bash
cd frontend
tsx --test test/task-long-content.test.ts
```

Expected: 3 项测试全部 PASS。

- [ ] **Step 5: 检查并提交纯函数**

Run:

```bash
git diff --check
git add frontend/src/components/console/task/task-long-content.ts frontend/test/task-long-content.test.ts
git commit -m "增加超长文本文件转换工具"
```

Expected: 提交仅包含纯函数与真实文件内容测试。

---

### Task 2: 转换确认弹窗与本地化

**Files:**
- Create: `frontend/src/components/console/task/task-long-content-dialog.tsx`
- Create: `frontend/test/task-long-content-dialog.test.ts`
- Modify: `frontend/src/i18n/resources/cn.ts:4040-4084`
- Modify: `frontend/src/i18n/resources/en.ts:4040-4084`
- Modify: `frontend/test/task-detail-i18n.test.ts:27-83`

**Interfaces:**
- Consumes: `open: boolean`、`characterCount: number`、`filename: string`、`converting: boolean`、`onOpenChange(open: boolean): void`、`onConfirm(): void | Promise<void>`。
- Produces: `TaskLongContentDialog`，上传期间保持打开并锁定所有操作。
- Produces: `taskDetail.chat.longContent.*` 中英文资源。

- [ ] **Step 1: 编写失败的弹窗与 i18n 契约测试**

创建 `frontend/test/task-long-content-dialog.test.ts`：

```ts
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
```

在 `frontend/test/task-detail-i18n.test.ts` 的资源测试中增加：

```ts
assert.equal(cn.taskDetail.chat.longContent.manualConvert, "转为 TXT")
assert.equal(en.taskDetail.chat.longContent.manualConvert, "Convert to TXT")
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
cd frontend
tsx --test test/task-long-content-dialog.test.ts test/task-detail-i18n.test.ts
```

Expected: FAIL，提示弹窗模块或 `longContent` 资源缺失。

- [ ] **Step 3: 增加中英文资源**

在 `cn.ts` 的 `taskDetail.chat` 中增加：

```ts
longContent: {
  title: "内容超出长度限制",
  description: "当前内容共 {{count}} 字，可转为 TXT 附件后继续补充说明。",
  filename: "文件名：{{filename}}",
  fileLimit: "单个附件最大 {{size}}",
  convert: "转为 TXT 附件",
  manualConvert: "转为 TXT",
  converting: "正在转换并上传...",
  convertFailed: "TXT 附件生成失败，请重试",
  addDescription: "TXT 附件已生成，请补充说明后发送",
},
```

在 `en.ts` 的 `taskDetail.chat` 中增加：

```ts
longContent: {
  title: "Content exceeds the length limit",
  description: "This content contains {{count}} characters. Convert it to a TXT attachment, then add a message.",
  filename: "File name: {{filename}}",
  fileLimit: "Maximum attachment size: {{size}}",
  convert: "Convert to TXT attachment",
  manualConvert: "Convert to TXT",
  converting: "Converting and uploading...",
  convertFailed: "Failed to create the TXT attachment. Please retry.",
  addDescription: "TXT attachment created. Add a message before sending.",
},
```

- [ ] **Step 4: 实现确认弹窗**

创建 `frontend/src/components/console/task/task-long-content-dialog.tsx`：

```tsx
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { MAX_TASK_UPLOAD_FILE_SIZE_LABEL } from "./task-file-upload"

interface TaskLongContentDialogProps {
  open: boolean
  characterCount: number
  filename: string
  converting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function TaskLongContentDialog({
  open,
  characterCount,
  filename,
  converting,
  onOpenChange,
  onConfirm,
}: TaskLongContentDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (converting) return
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("taskDetail.chat.longContent.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("taskDetail.chat.longContent.description", { count: characterCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="break-all">{t("taskDetail.chat.longContent.filename", { filename })}</div>
          <div className="text-xs text-muted-foreground">
            {t("taskDetail.chat.longContent.fileLimit", { size: MAX_TASK_UPLOAD_FILE_SIZE_LABEL })}
          </div>
        </div>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={converting}
            onClick={() => onOpenChange(false)}
          >
            {t("taskDetail.common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={converting}
            onClick={() => void onConfirm()}
          >
            {converting
              ? t("taskDetail.chat.longContent.converting")
              : t("taskDetail.chat.longContent.convert")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 5: 运行弹窗与 i18n 测试**

Run:

```bash
cd frontend
tsx --test test/task-long-content-dialog.test.ts test/task-detail-i18n.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 6: 检查并提交弹窗任务**

Run:

```bash
git diff --check
git add frontend/src/components/console/task/task-long-content-dialog.tsx frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-long-content-dialog.test.ts frontend/test/task-detail-i18n.test.ts
git commit -m "增加超长文本转换确认弹窗"
```

Expected: 提交包含弹窗、中英文资源和对应测试。

---

### Task 3: 对话输入框转换编排

**Files:**
- Modify: `frontend/src/components/console/task/chat-inputbox.tsx:1-1159`
- Create: `frontend/test/task-long-content-integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `hasCrossedTaskContentLimit()`、`createLongContentFileName()`、`createLongContentTextFile()`。
- Consumes: Task 2 的 `TaskLongContentDialog`。
- Consumes: `uploadTaskFile(file: File): Promise<TaskUploadedFile>`、`TaskUploadFileTooLargeError` 和现有 `handleUploaded()`。
- Produces: 首次越界自动提示、执行中延迟提示、取消抑制、手动重开、成功清空、失败保留的完整交互。

- [ ] **Step 1: 编写失败的输入框集成契约测试**

创建 `frontend/test/task-long-content-integration.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
cd frontend
tsx --test test/task-long-content-integration.test.ts
```

Expected: 3 项测试 FAIL，提示转换状态、上传调用和弹窗渲染缺失。

- [ ] **Step 3: 增加导入、状态和任务保护引用**

在 `chat-inputbox.tsx` 导入：

```ts
import { IconCommand, IconDots, IconFileText, IconLoader, IconPalette, IconReload, IconTrash, IconSend, IconSparkles, IconTerminal2, IconUpload } from "@tabler/icons-react"
import {
  isCompressibleImageFile,
  MAX_TASK_UPLOAD_FILE_SIZE_BYTES,
  MAX_TASK_UPLOAD_FILE_SIZE_LABEL,
  TaskFileUploadDialog,
  TaskUploadedFileItem,
  TaskUploadFileTooLargeError,
  uploadTaskFile,
  type TaskUploadedFile,
} from "./task-file-upload"
import {
  createLongContentFileName,
  createLongContentTextFile,
  hasCrossedTaskContentLimit,
} from "./task-long-content"
import { TaskLongContentDialog } from "./task-long-content-dialog"
```

在 `QueuedTaskInput` 后增加：

```ts
interface LongContentConversionDraft {
  content: string
  filename: string
}
```

在组件状态区增加：

```ts
const [longContentDraft, setLongContentDraft] = useState<LongContentConversionDraft | null>(null)
const [longContentConverting, setLongContentConverting] = useState(false)
const [longContentPromptPending, setLongContentPromptPending] = useState(false)
const [longContentPromptSuppressed, setLongContentPromptSuppressed] = useState(false)
const currentTaskIdRef = useRef(taskId)
```

将输入锁更新为：

```ts
const inputLocked = autoSendingQueuedInput || longContentConverting
const contentLength = content.length
```

同时删除组件后半段原有的 `const contentLength = content.length`，确保自动提示 effect 的依赖在调用前完成初始化。

在 mounted effect 后同步当前任务：

```ts
React.useEffect(() => {
  currentTaskIdRef.current = taskId
  setLongContentDraft(null)
  setLongContentConverting(false)
  setLongContentPromptPending(false)
  setLongContentPromptSuppressed(false)
}, [taskId])
```

- [ ] **Step 4: 实现弹窗打开、取消和自动延迟提示**

在 `handleUploaded()` 后增加：

```ts
const openLongContentDialog = React.useCallback(() => {
  if (content.length <= MAX_TASK_CONTENT_LENGTH) return

  if (uploadedFiles.length >= MAX_UPLOADED_FILES) {
    toast.error(t("taskDetail.chat.toast.maxFiles", { count: MAX_UPLOADED_FILES }))
    setLongContentPromptSuppressed(true)
    return
  }

  setLongContentDraft({
    content,
    filename: createLongContentFileName(new Date()),
  })
}, [content, t, uploadedFiles.length])

const handleLongContentDialogOpenChange = (open: boolean) => {
  if (open || longContentConverting) return
  setLongContentDraft(null)
  setLongContentPromptSuppressed(true)
}

const handleManualLongContentConversion = () => {
  setLongContentPromptPending(false)
  openLongContentDialog()
}

React.useEffect(() => {
  if (contentLength <= MAX_TASK_CONTENT_LENGTH) {
    setLongContentPromptPending(false)
    setLongContentPromptSuppressed(false)
    return
  }

  if (!longContentPromptPending || isComposing || !canUseIdleControls) {
    return
  }

  setLongContentPromptPending(false)
  openLongContentDialog()
}, [canUseIdleControls, contentLength, isComposing, longContentPromptPending, openLongContentDialog])
```

将 `handleContentChange()` 更新为：

```ts
const handleContentChange = (nextContent: string) => {
  if (
    selectedQuickInputRef.current
    && normalizeQuickInputText(selectedQuickInputRef.current) !== normalizeQuickInputText(nextContent)
  ) {
    selectedQuickInputRef.current = null
  }

  if (
    !longContentPromptSuppressed
    && hasCrossedTaskContentLimit(content.length, nextContent.length, MAX_TASK_CONTENT_LENGTH)
  ) {
    setLongContentPromptPending(true)
  }

  setContent(nextContent)
}
```

Expected: 普通输入和粘贴都经过同一受控 `onChange`；执行期间 pending 保持为 true，空闲后 effect 使用最新 `content` 创建快照。

- [ ] **Step 5: 实现异步转换与上传**

在长文本处理函数区域增加：

```ts
const handleConfirmLongContentConversion = async () => {
  if (!longContentDraft || longContentConverting) return

  const conversionTaskId = taskId
  setLongContentConverting(true)
  try {
    const file = createLongContentTextFile(longContentDraft.content, longContentDraft.filename)
    const uploadedFile = await uploadTaskFile(file)

    if (!mountedRef.current || currentTaskIdRef.current !== conversionTaskId) {
      return
    }

    handleUploaded(uploadedFile)
    removeTaskInputDraft(taskId)
    setContent('')
    setLongContentDraft(null)
    setLongContentPromptPending(false)
    setLongContentPromptSuppressed(false)
    toast.success(t("taskDetail.chat.longContent.addDescription"))
  } catch (error) {
    if (!mountedRef.current || currentTaskIdRef.current !== conversionTaskId) {
      return
    }

    const message = error instanceof TaskUploadFileTooLargeError
      ? t("taskDetail.chat.toast.fileTooLarge", { size: MAX_TASK_UPLOAD_FILE_SIZE_LABEL })
      : t("taskDetail.chat.longContent.convertFailed")
    toast.error(message)
    console.error("Failed to convert long task input:", error)
  } finally {
    if (mountedRef.current && currentTaskIdRef.current === conversionTaskId) {
      setLongContentConverting(false)
    }
  }
}
```

Expected: 成功路径通过 `handleUploaded()` 复用附件追加和焦点恢复；所有失败路径保留 `content`、草稿和已有附件。

- [ ] **Step 6: 增加超限操作和确认弹窗**

将超限提示改为：

```tsx
{contentTooLong && (
  <div className="mt-1 flex items-center justify-between gap-2 px-1 text-xs text-destructive">
    <span>
      {t("taskDetail.chat.contentTooLongInline", {
        overCount: contentLength - MAX_TASK_CONTENT_LENGTH,
        maxCount: MAX_TASK_CONTENT_LENGTH,
      })}
    </span>
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="shrink-0 text-destructive hover:text-destructive"
      disabled={longContentConverting || !canUseIdleControls}
      onClick={handleManualLongContentConversion}
    >
      <IconFileText className="size-3.5" />
      {t("taskDetail.chat.longContent.manualConvert")}
    </Button>
  </div>
)}
```

在 `TaskFileUploadDialog` 前增加：

```tsx
<TaskLongContentDialog
  open={!!longContentDraft}
  characterCount={longContentDraft?.content.length ?? contentLength}
  filename={longContentDraft?.filename ?? ""}
  converting={longContentConverting}
  onOpenChange={handleLongContentDialogOpenChange}
  onConfirm={handleConfirmLongContentConversion}
/>
```

- [ ] **Step 7: 运行专项与现有附件回归测试**

Run:

```bash
cd frontend
tsx --test test/task-long-content.test.ts test/task-long-content-dialog.test.ts test/task-long-content-integration.test.ts test/task-detail-i18n.test.ts test/task-image-compression.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 8: 检查并提交输入框编排**

Run:

```bash
git diff --check
git add frontend/src/components/console/task/chat-inputbox.tsx frontend/test/task-long-content-integration.test.ts
git commit -m "实现超长文本转附件流程"
```

Expected: 提交包含输入框状态编排与集成契约测试。

---

### Task 4: 完整验证与 SaaS 人工验收

**Files:**
- Verify: `frontend/src/components/console/task/task-long-content.ts`
- Verify: `frontend/src/components/console/task/task-long-content-dialog.tsx`
- Verify: `frontend/src/components/console/task/chat-inputbox.tsx`
- Verify: `frontend/src/i18n/resources/cn.ts`
- Verify: `frontend/src/i18n/resources/en.ts`

**Interfaces:**
- Consumes: Task 1-3 形成的完整超长文本转换流程。
- Produces: 可供 PR 评审的自动验证、SaaS 交互验收和干净分支状态。

- [ ] **Step 1: 运行全部相关专项测试**

Run:

```bash
cd frontend
tsx --test test/task-long-content.test.ts test/task-long-content-dialog.test.ts test/task-long-content-integration.test.ts test/task-detail-i18n.test.ts test/task-image-compression.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 2: 运行前端静态检查**

Run:

```bash
cd frontend
pnpm lint
```

Expected: ESLint 退出码为 0。

- [ ] **Step 3: 运行在线模式构建**

Run:

```bash
cd frontend
pnpm run build:online
```

Expected: TypeScript 和 Vite 构建成功，退出码为 0。

- [ ] **Step 4: 启动连接 SaaS 后端的前端预览**

使用 `deploy-website` skill 和 background terminal 启动：

```bash
cd frontend
TARGET=https://monkeycode-ai.com pnpm run dev:online
```

Expected: Vite 在端口 `11180` 启动，平台预览地址返回 HTTP 200，`/api` 和 WebSocket 请求连接 SaaS 后端。

- [ ] **Step 5: 完成人工交互验收**

逐项检查：

1. 输入 10000 字时保持正常发送能力。
2. 输入第 10001 字时自动打开转换确认弹窗。
3. 一次粘贴超过 10000 字时自动打开确认弹窗，全文字符数正确。
4. 中文 IME 组合输入期间弹窗保持稳定，组合结束后触发。
5. 取消后原文完整保留，继续输入不会重复弹窗。
6. 点击“转为 TXT”可重新打开弹窗。
7. 确认后显示时间命名的 TXT 附件，输入框清空并恢复焦点。
8. 仅有转换附件时发送按钮保持禁用，填写说明后可发送。
9. 删除转换附件后可继续正常输入和上传。
10. 已有 3 个附件时保留原文并提示数量限制。
11. 超过 2MB 的文本保留原文并提示文件过大。
12. 模拟上传失败后原文和已有附件保持完整，允许重试。
13. Agent 执行中粘贴超长文本，恢复空闲后使用最新全文弹窗。
14. 普通文件选择、文件粘贴、拖拽上传、画板附件和队列发送保持正常。
15. 中文和英文界面文案完整，弹窗键盘焦点顺序正确。

- [ ] **Step 6: 汇总分支状态**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline -5
```

Expected: 工作区仅保留既有 `.monkeycode/` 未跟踪目录；分支包含设计、纯函数、弹窗和输入框编排的独立中文提交。
