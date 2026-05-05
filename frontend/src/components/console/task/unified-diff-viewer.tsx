import { IconLoader, IconReport } from "@tabler/icons-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

export type DiffViewMode = "unified" | "split"

export interface UnifiedDiffViewerProps {
  diffText: string
  loading?: boolean
  viewMode?: DiffViewMode
}

type DiffFile = {
  oldPath: string
  newPath: string
  isBinary: boolean
  hunks: DiffHunk[]
}

type DiffHunk = {
  header: string
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

type DiffLine = {
  type: "context" | "add" | "delete" | "meta"
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function normalizePath(path: string) {
  const trimmed = path.trim()
  const withoutTimestamp = trimmed.split(/\t| {2,}/)[0] || trimmed
  if (withoutTimestamp === "/dev/null") return withoutTimestamp
  return withoutTimestamp.replace(/^"|"$/g, "").replace(/^[ab]\//, "")
}

function getDisplayPath(file: DiffFile) {
  if (file.newPath && file.newPath !== "/dev/null") return file.newPath
  if (file.oldPath && file.oldPath !== "/dev/null") return file.oldPath
  return "未知文件"
}

function getDisplayFileName(file: DiffFile) {
  const path = getDisplayPath(file)
  return path.split("/").pop() || path
}

function getMaxLineNumberDigits(files: DiffFile[]) {
  let maxLineNumber = 0
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        maxLineNumber = Math.max(maxLineNumber, line.oldLineNumber ?? 0, line.newLineNumber ?? 0)
      }
    }
  }
  return Math.max(String(maxLineNumber).length, 1)
}

function parseUnifiedDiff(diffText: string): DiffFile[] {
  const lines = diffText.replace(/\r\n/g, "\n").split("\n")
  const files: DiffFile[] = []
  let currentFile: DiffFile | null = null
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  const ensureFile = () => {
    if (!currentFile) {
      currentFile = { oldPath: "", newPath: "", isBinary: false, hunks: [] }
      files.push(currentFile)
    }
    return currentFile
  }

  for (const rawLine of lines) {
    if (rawLine.startsWith("diff --git ")) {
      currentFile = { oldPath: "", newPath: "", isBinary: false, hunks: [] }
      currentHunk = null
      files.push(currentFile)
      continue
    }

    if (rawLine.startsWith("Binary files ") || rawLine.startsWith("GIT binary patch")) {
      ensureFile().isBinary = true
      currentHunk = null
      continue
    }

    if (rawLine.startsWith("--- ")) {
      currentHunk = null
      ensureFile().oldPath = normalizePath(rawLine.slice(4))
      continue
    }

    if (rawLine.startsWith("+++ ")) {
      currentHunk = null
      ensureFile().newPath = normalizePath(rawLine.slice(4))
      continue
    }

    const hunkMatch = rawLine.match(HUNK_HEADER_RE)
    if (hunkMatch) {
      const file = ensureFile()
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[3])
      currentHunk = {
        header: rawLine,
        oldStart: oldLine,
        newStart: newLine,
        lines: [],
      }
      file.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk) {
      continue
    }

    if (rawLine.startsWith("\\")) {
      currentHunk.lines.push({ type: "meta", content: rawLine })
      continue
    }

    const marker = rawLine[0]
    const content = rawLine.slice(1)

    if (marker === "+") {
      currentHunk.lines.push({ type: "add", content, newLineNumber: newLine })
      newLine += 1
      continue
    }

    if (marker === "-") {
      currentHunk.lines.push({ type: "delete", content, oldLineNumber: oldLine })
      oldLine += 1
      continue
    }

    currentHunk.lines.push({ type: "context", content: marker === " " ? content : rawLine, oldLineNumber: oldLine, newLineNumber: newLine })
    oldLine += 1
    newLine += 1
  }

  return files.filter((file) => file.isBinary || file.hunks.length > 0)
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <Empty className="w-full h-full min-h-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconReport className="size-6" />
        </EmptyMedia>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function LoadingState() {
  return (
    <Empty className="w-full h-full min-h-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconLoader className="size-6 animate-spin" />
        </EmptyMedia>
        <EmptyDescription>加载中...</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function LineNumber({ value }: { value?: number }) {
  return <span className="block select-none whitespace-nowrap px-2 text-right text-muted-foreground tabular-nums">{value ?? ""}</span>
}

function LineNumberCell({ value, className }: { value?: number; className?: string }) {
  return <span className={cn("bg-muted/50", className)}><LineNumber value={value} /></span>
}

function UnifiedLine({ line, lineNumberWidth }: { line: DiffLine; lineNumberWidth: string }) {
  const isAdd = line.type === "add"
  const isDelete = line.type === "delete"
  const isMeta = line.type === "meta"
  const lineNumber = line.newLineNumber ?? line.oldLineNumber

  return (
    <div
      className={cn(
        "grid border-b border-transparent font-mono text-xs leading-5",
        isAdd && "bg-green-500/8",
        isDelete && "bg-red-500/8",
        isMeta && "text-muted-foreground italic"
      )}
      style={{ gridTemplateColumns: `${lineNumberWidth} 1.5rem minmax(0, 1fr)` }}
    >
      <LineNumberCell value={lineNumber} />
      <span className={cn("select-none text-center", isAdd && "text-green-700 dark:text-green-400", isDelete && "text-red-700 dark:text-red-400")}>{isAdd ? "+" : isDelete ? "-" : ""}</span>
      <pre className="min-w-0 whitespace-pre-wrap break-words pr-2 font-mono">{line.content || " "}</pre>
    </div>
  )
}

function UnifiedHunkSeparator({ lineNumberWidth }: { lineNumberWidth: string }) {
  return (
    <div className="grid border-y bg-muted/30 font-mono text-xs leading-5 text-muted-foreground" style={{ gridTemplateColumns: `${lineNumberWidth} 1.5rem minmax(0, 1fr)` }}>
      <LineNumberCell />
      <span />
      <span className="select-none pr-2">...</span>
    </div>
  )
}

function SplitRows({ hunk, lineNumberWidth }: { hunk: DiffHunk; lineNumberWidth: string }) {
  const rows: Array<{ oldLine?: DiffLine; newLine?: DiffLine }> = []

  for (let index = 0; index < hunk.lines.length; index += 1) {
    const line = hunk.lines[index]
    if (line.type === "delete" && hunk.lines[index + 1]?.type === "add") {
      rows.push({ oldLine: line, newLine: hunk.lines[index + 1] })
      index += 1
      continue
    }
    if (line.type === "delete") {
      rows.push({ oldLine: line })
      continue
    }
    if (line.type === "add") {
      rows.push({ newLine: line })
      continue
    }
    rows.push({ oldLine: line, newLine: line })
  }

  return rows.map((row, index) => <SplitLine key={`${hunk.header}-${index}`} oldLine={row.oldLine} newLine={row.newLine} lineNumberWidth={lineNumberWidth} />)
}

function SplitLine({ oldLine, newLine, lineNumberWidth }: { oldLine?: DiffLine; newLine?: DiffLine; lineNumberWidth: string }) {
  const oldIsDelete = oldLine?.type === "delete"
  const newIsAdd = newLine?.type === "add"
  const isMeta = oldLine?.type === "meta" || newLine?.type === "meta"

  return (
    <div className="grid font-mono text-xs leading-5 min-w-0" style={{ gridTemplateColumns: `${lineNumberWidth} 1.5rem minmax(0, 1fr) ${lineNumberWidth} 1.5rem minmax(0, 1fr)` }}>
      <LineNumberCell value={oldLine?.oldLineNumber} />
      <span className={cn("select-none text-center", oldIsDelete && "bg-red-500/8 text-red-700 dark:text-red-400")}>{oldIsDelete ? "-" : ""}</span>
      <pre className={cn("min-w-0 whitespace-pre-wrap break-words pr-2 font-mono", oldIsDelete && "bg-red-500/8", isMeta && "text-muted-foreground italic")}>{oldLine?.content || " "}</pre>
      <LineNumberCell value={newLine?.newLineNumber} className="border-l" />
      <span className={cn("select-none text-center", newIsAdd && "bg-green-500/8 text-green-700 dark:text-green-400")}>{newIsAdd ? "+" : ""}</span>
      <pre className={cn("min-w-0 whitespace-pre-wrap break-words pr-2 font-mono", newIsAdd && "bg-green-500/8", isMeta && "text-muted-foreground italic")}>{newLine?.content || " "}</pre>
    </div>
  )
}

function HunkView({ hunk, viewMode, lineNumberWidth }: { hunk: DiffHunk; viewMode: DiffViewMode; lineNumberWidth: string }) {
  return (
    <div>
      {viewMode === "split" ? <SplitRows hunk={hunk} lineNumberWidth={lineNumberWidth} /> : hunk.lines.map((line, index) => <UnifiedLine key={`${hunk.header}-${index}`} line={line} lineNumberWidth={lineNumberWidth} />)}
    </div>
  )
}

function FileHunksView({ hunks, viewMode, lineNumberWidth }: { hunks: DiffHunk[]; viewMode: DiffViewMode; lineNumberWidth: string }) {
  return hunks.map((hunk, hunkIndex) => (
    <div key={`${hunk.header}-${hunkIndex}`}>
      {hunkIndex > 0 && <UnifiedHunkSeparator lineNumberWidth={lineNumberWidth} />}
      <HunkView hunk={hunk} viewMode={viewMode} lineNumberWidth={lineNumberWidth} />
    </div>
  ))
}

export function UnifiedDiffViewer({ diffText, loading = false, viewMode = "unified" }: UnifiedDiffViewerProps) {
  if (loading) return <LoadingState />
  if (!diffText.trim()) return <EmptyState>暂无变更</EmptyState>

  let files: DiffFile[]
  try {
    files = parseUnifiedDiff(diffText)
  } catch {
    return <EmptyState>变更内容解析失败</EmptyState>
  }

  if (files.length === 0) return <EmptyState>暂无文本变更</EmptyState>

  const lineNumberWidth = `calc(${getMaxLineNumberDigits(files)}ch + 1rem)`

  return (
    <div className="h-full overflow-auto bg-background" style={{ fontFamily: "'JetBrains Mono Variable','Noto Sans SC Variable', monospace" }}>
      <div className="w-full min-w-0 overflow-hidden rounded-md bg-muted/20">
        {files.map((file, fileIndex) => (
          <div key={`${file.oldPath}-${file.newPath}-${fileIndex}`}>
            <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-2 font-mono text-xs font-medium backdrop-blur">
              {getDisplayFileName(file)}
            </div>
            {file.isBinary ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">二进制文件变更，无法展示文本 diff</div>
            ) : (
              <FileHunksView hunks={file.hunks} viewMode={viewMode} lineNumberWidth={lineNumberWidth} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
