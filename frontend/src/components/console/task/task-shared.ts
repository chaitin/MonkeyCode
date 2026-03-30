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
