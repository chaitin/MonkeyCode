import { useEffect, useState, type ReactNode } from "react"
import { useAppToast } from "@/components/animated-toast-provider"
import { useAuth } from "@/hooks/use-auth"
import { ApiError, api } from "@/lib/api"
import { base } from "@/lib/resources"
import {
  SkillTagsContext,
  type SkillTag,
  type SkillTagsContextValue,
} from "@/lib/skill-tags"
export function SkillTagsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { showToast } = useAppToast()
  const [tags, setTags] = useState<SkillTag[]>([])
  const [loadedForUser, setLoadedForUser] = useState(user)
  useEffect(() => {
    if (user?.role !== "admin") return
    let active = true
    api<{ items: SkillTag[] }>(base + "/tags")
      .then((r) => {
        if (active) {
          setTags(r.items)
          setLoadedForUser(user)
        }
      })
      .catch((e) => {
        if (active) {
          setTags([])
          setLoadedForUser(null)
          showToast({ status: "error", title: e.message })
        }
      })
    return () => {
      active = false
    }
  }, [showToast, user])
  const visibleTags =
    user?.role === "admin" && loadedForUser === user ? tags : []
  const save = async (id: string | undefined, name: string) => {
    try {
      const normalized = name.trim().replace(/\s+/g, " ")
      if (!normalized) return "failed" as const
      const tag = await api<SkillTag>(base + "/tags" + (id ? `/${id}` : ""), {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({ name: normalized }),
      })
      setTags((current) =>
        id ? current.map((t) => (t.id === id ? tag : t)) : [...current, tag]
      )
      return "saved" as const
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return "conflict" as const
      showToast({
        status: "error",
        title: e instanceof Error ? e.message : "标签保存失败",
      })
      return "failed" as const
    }
  }
  const value: SkillTagsContextValue = {
    tags: visibleTags,
    addTag: (name) => save(undefined, name),
    renameTag: save,
    deleteTag: async (id) => {
      try {
        await api(base + `/tags/${id}`, { method: "DELETE" })
        setTags((current) => current.filter((t) => t.id !== id))
        return true
      } catch (e) {
        showToast({
          status: "error",
          title: e instanceof Error ? e.message : "标签删除失败",
        })
        return false
      }
    },
  }
  return (
    <SkillTagsContext.Provider value={value}>
      {children}
    </SkillTagsContext.Provider>
  )
}
