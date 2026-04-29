import { b64decode } from "@/utils/common"

export interface AvailableCommand {
  name: string
  description: string
  input: {
    hint: string | null
  } | null
}

export interface PlanEntry {
  content: string
  status: string
}

export interface TaskPlan {
  entries: PlanEntry[]
  version: number
}

export interface AvailableCommands {
  commands: AvailableCommand[]
  version: number
}

export type TaskStreamStatus = "inited" | "executing" | "waiting" | "finished" | "error"

export interface TaskUserInputAttachment {
  url: string
  filename: string
}

export interface TaskUserInputPayload {
  content: string
  attachments: TaskUserInputAttachment[]
}

export type TaskUserInput = string | TaskUserInputPayload

function fallbackFilenameFromUrl(url: string, index: number) {
  const fallbackName = `附件 ${index + 1}`
  try {
    const parsedUrl = new URL(url)
    const name = parsedUrl.pathname.split("/").filter(Boolean).pop()
    return name ? decodeURIComponent(name) : fallbackName
  } catch {
    try {
      const name = url.split("?")[0]?.split("/").filter(Boolean).pop()
      return name ? decodeURIComponent(name) : fallbackName
    } catch {
      return fallbackName
    }
  }
}

function normalizeAttachments(attachments: unknown): TaskUserInputAttachment[] {
  if (!Array.isArray(attachments)) {
    return []
  }

  return attachments
    .map((attachment, index) => {
      if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
        return null
      }

      const maybeAttachment = attachment as Partial<TaskUserInputAttachment>
      const url = typeof maybeAttachment.url === "string" ? maybeAttachment.url.trim() : ""
      if (!url) {
        return null
      }

      const filename = typeof maybeAttachment.filename === "string" && maybeAttachment.filename.trim() !== ""
        ? maybeAttachment.filename
        : fallbackFilenameFromUrl(url, index)

      return { url, filename }
    })
    .filter((attachment): attachment is TaskUserInputAttachment => attachment !== null)
}

export function normalizeTaskUserInput(input: TaskUserInput): TaskUserInputPayload {
  if (typeof input === "string") {
    return {
      content: input,
      attachments: [],
    }
  }

  return {
    content: typeof input.content === "string" ? input.content : "",
    attachments: normalizeAttachments(input.attachments),
  }
}

export function parseTaskUserInputPayload(decoded: string): TaskUserInputPayload {
  try {
    const parsed = JSON.parse(decoded) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const maybePayload = parsed as Partial<TaskUserInputPayload>
      if (typeof maybePayload.content === "string" && Array.isArray(maybePayload.attachments)) {
        try {
          return normalizeTaskUserInput({
            content: b64decode(maybePayload.content),
            attachments: maybePayload.attachments,
          })
        } catch {
          return normalizeTaskUserInput({
            content: decoded,
            attachments: [],
          })
        }
      }
      if (typeof maybePayload.content === "string") {
        return normalizeTaskUserInput({
          content: decoded,
          attachments: [],
        })
      }
    }
  } catch {
    // 旧协议是纯文本，不是 JSON。
  }

  return normalizeTaskUserInput(decoded)
}

export enum RepoFileEntryMode {
  RepoEntryModeUnspecified = 0,
  RepoEntryModeFile = 1,
  RepoEntryModeExecutable = 2,
  RepoEntryModeSymlink = 3,
  RepoEntryModeTree = 4,
  RepoEntryModeSubmodule = 5,
}

export interface RepoFileStatus {
  entry_mode: RepoFileEntryMode
  mode: number | null
  modified_at: number
  name: string
  path: string
  size: number
  symlink_target?: string | null
}

export interface RepoFileChange {
  additions?: number
  deletions?: number
  old_path?: string
  path: string
  status: "M" | "RM" | "A" | "D" | "R" | "??" | string
}

export interface TaskRepositoryClient {
  getFileList(path: string): Promise<RepoFileStatus[] | null>
  getFileDiff(path: string): Promise<string | null>
  getFileChanges(): Promise<RepoFileChange[] | null>
  getFileContent(path: string): Promise<Uint8Array | null>
}
