import { useEffect, useState, type ReactNode } from "react"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { base } from "@/lib/resources"
import {
  SkillTagsContext,
  type SkillTag,
  type SkillTagsContextValue,
} from "@/lib/skill-tags"
export function SkillTagsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [tags, setTags] = useState<SkillTag[]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    api<{ items: SkillTag[] }>(base + "/tags")
      .then((r) => {
        if (active) {
          setTags(r.items)
          setError("")
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [isAuthenticated])
  const save = async (id: string | undefined, name: string) => {
    try {
      const normalized = name.trim().replace(/\s+/g, " ")
      if (!normalized) return false
      const tag = await api<SkillTag>(base + "/tags" + (id ? `/${id}` : ""), {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({ name: normalized }),
      })
      setTags((current) =>
        id ? current.map((t) => (t.id === id ? tag : t)) : [...current, tag]
      )
      setError("")
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "标签保存失败")
      return false
    }
  }
  const value: SkillTagsContextValue = {
    tags,
    addTag: (name) => save(undefined, name),
    renameTag: save,
    deleteTag: async (id) => {
      try {
        await api(base + `/tags/${id}`, { method: "DELETE" })
        setTags((current) => current.filter((t) => t.id !== id))
        setError("")
      } catch (e) {
        setError(e instanceof Error ? e.message : "标签删除失败")
      }
    },
  }
  return (
    <SkillTagsContext.Provider value={value}>
      {isAuthenticated && error && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {children}
    </SkillTagsContext.Provider>
  )
}
