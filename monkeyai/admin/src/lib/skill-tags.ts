import { createContext } from "react"

export type SkillTag = {
  id: string
  name: string
}

export type SkillTagsContextValue = {
  tags: SkillTag[]
  addTag: (name: string) => boolean
  renameTag: (id: string, name: string) => boolean
  deleteTag: (id: string) => void
}

export const INITIAL_SKILL_TAGS: SkillTag[] = [
  { id: "code", name: "代码" },
  { id: "review", name: "审查" },
  { id: "security", name: "安全" },
  { id: "data", name: "数据" },
  { id: "analysis", name: "分析" },
  { id: "product", name: "产品" },
  { id: "copywriting", name: "文案" },
  { id: "operations", name: "运维" },
  { id: "incident-response", name: "故障处理" },
  { id: "weekly-report", name: "周报" },
  { id: "writing", name: "写作" },
  { id: "research", name: "调研" },
  { id: "notes", name: "笔记" },
]

export const SkillTagsContext = createContext<SkillTagsContextValue | null>(
  null
)
