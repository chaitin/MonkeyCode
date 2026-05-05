import { createPatch } from "diff"
import { UnifiedDiffViewer, type DiffViewMode } from "../unified-diff-viewer"

const PATCH_OPTIONS = {
  headerOptions: {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: true,
  },
} as const

const sanitizeDiffPath = (value: unknown) => {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/[\r\n\t]+/g, " ").trim()
}

const coerceDiffText = (value: unknown) => {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

const buildPreview = (filePath: unknown, oldValue: unknown, newValue: unknown) => {
  const safePath = sanitizeDiffPath(filePath) || "untitled"
  const oldText = coerceDiffText(oldValue)
  const newText = coerceDiffText(newValue)

  try {
    const diffText = createPatch(safePath, oldText, newText, "", "", PATCH_OPTIONS)

    return {
      error: null,
      diffText,
      oldText,
      newText,
      safePath,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "diff 解析失败",
      diffText: "",
      oldText,
      newText,
      safePath,
    }
  }
}

export const EditDiffPreview = ({
  filePath,
  oldValue,
  newValue,
  hunkClassName,
  padded = false,
}: {
  filePath: unknown
  oldValue: unknown
  newValue: unknown
  hunkClassName?: string
  padded?: boolean
}) => {
  const { error, diffText, oldText, newText, safePath } = buildPreview(filePath, oldValue, newValue)
  const hasChanges = oldText !== newText
  const viewMode: DiffViewMode = !oldText ? "unified" : "split"

  if (error) {
    return (
      <div className={padded ? "space-y-3 p-3" : "space-y-3"}>
        <div className="text-muted-foreground">
          Diff 预览失败，已回退为文本展示。
        </div>
        <pre className="overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3 text-[11px] leading-5 text-muted-foreground">
          {`文件: ${safePath}\n\n--- old ---\n${oldText || "(empty)"}\n\n--- new ---\n${newText || "(empty)"}\n\n[parse error] ${error}`}
        </pre>
      </div>
    )
  }

  if (!diffText.trim()) {
    return (
      <div className={padded ? "p-3 text-muted-foreground" : "text-muted-foreground"}>
        {hasChanges ? "未生成可展示的 diff" : "未检测到文本差异"}
      </div>
    )
  }

  return (
    <div className={padded ? "p-3" : undefined} data-hunk-class-name={hunkClassName}>
      <UnifiedDiffViewer diffText={diffText} viewMode={viewMode} />
    </div>
  )
}
