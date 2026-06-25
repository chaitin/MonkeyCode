import { cn } from "@/lib/utils"
import type { MessageType } from "../message"
import { taskDetailT } from "../task-i18n"
import { UnifiedDiffViewer } from "../unified-diff-viewer"

type ApplyPatchSection = {
  header: string
  lines: string[]
}

const APPLY_PATCH_FILE_HEADER_RE = /^\*\*\* (?:Update|Add|Delete) File: /

export const match = (message: MessageType) => message.data.title === "apply_patch"

export const renderTitle = (message: MessageType) => {
  if (message.data.status === "pending" || message.data.status === "in_progress") return taskDetailT("toolcall.editingFile")
  if (message.data.status === "failed") return taskDetailT("toolcall.editFailed")
  return message.data.title
}

const isUnifiedDiffText = (value: string) => {
  return /^diff --git /m.test(value) || (/^--- /m.test(value) && /^\+\+\+ /m.test(value) && /^@@ -\d+/m.test(value))
}

const isApplyPatchText = (value: string) => {
  const trimmed = value.trim()
  return trimmed.startsWith("*** Begin Patch") && trimmed.includes("*** End Patch")
}

const parseApplyPatchSections = (patchText: string) => {
  const sections: ApplyPatchSection[] = []
  let currentSection: ApplyPatchSection | null = null

  for (const line of patchText.replace(/\r\n/g, "\n").split("\n")) {
    if (APPLY_PATCH_FILE_HEADER_RE.test(line)) {
      if (currentSection) {
        sections.push(currentSection)
      }
      currentSection = {
        header: line,
        lines: [],
      }
      continue
    }

    if (!currentSection) {
      continue
    }

    if (line === "*** End Patch") {
      continue
    }

    currentSection.lines.push(line)
  }

  if (currentSection) {
    sections.push(currentSection)
  }

  return sections
}

const ApplyPatchLine = ({ line }: { line: string }) => {
  const isAdd = line.startsWith("+")
  const isDelete = line.startsWith("-")
  const isMeta = line.startsWith("@@") || line.startsWith("***")

  return (
    <div
      className={cn(
        "grid min-w-0 border-b border-transparent font-mono text-xs leading-5",
        isAdd && "bg-green-500/10 text-green-900 dark:bg-green-500/22 dark:text-green-100",
        isDelete && "bg-red-500/10 text-red-900 dark:bg-red-500/22 dark:text-red-100",
        isMeta && "bg-muted/40 text-muted-foreground",
      )}
      style={{ gridTemplateColumns: "1.5rem minmax(0, 1fr)" }}
    >
      <span className={cn("select-none text-center", isAdd && "text-green-700 dark:text-green-300", isDelete && "text-red-700 dark:text-red-300")}>
        {isAdd ? "+" : isDelete ? "-" : ""}
      </span>
      <pre className="min-w-0 whitespace-pre-wrap break-words pr-2 font-mono">{line || " "}</pre>
    </div>
  )
}

const ApplyPatchViewer = ({ patchText }: { patchText: string }) => {
  const sections = parseApplyPatchSections(patchText)

  if (sections.length === 0) {
    return (
      <pre className="whitespace-pre-wrap break-words p-3 text-xs">
        {patchText}
      </pre>
    )
  }

  return (
    <div className="space-y-3 p-3">
      {sections.map((section, index) => (
        <div key={`${section.header}-${index}`} className="overflow-hidden rounded-md border bg-background">
          <div className="border-b bg-muted/50 px-3 py-2 font-mono text-xs font-medium">
            {section.header.replace(/^\*\*\* /, "")}
          </div>
          <div>
            {section.lines.map((line, lineIndex) => (
              <ApplyPatchLine key={`${lineIndex}-${line}`} line={line} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export const renderPatchContent = (value: unknown) => {
  const patchText = typeof value === "string" ? value : ""

  if (!patchText.trim()) {
    return (
      <pre className="whitespace-pre-wrap break-words p-3 text-xs">
        {taskDetailT("toolcall.patchEmpty")}
      </pre>
    )
  }

  if (isUnifiedDiffText(patchText)) {
    return <UnifiedDiffViewer diffText={patchText} />
  }

  if (isApplyPatchText(patchText)) {
    return <ApplyPatchViewer patchText={patchText} />
  }

  return (
    <pre className="whitespace-pre-wrap break-words p-3 text-xs">
      {patchText}
    </pre>
  )
}

export const renderDetail = (message: MessageType) => {
  return renderPatchContent(message.data.rawInput?.patchText)
}
