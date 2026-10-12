import { useEffect, useState } from "react"

import { AuthorizationSelect } from "@/components/authorization-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { base, grants, match, selection, useSubjects, type Grant } from "@/lib/resources"
import type { AuthorizationSelection } from "@/lib/authorization-groups"

export function PackageGrants({
  kind, id, name, retired, onSaved, subjects,
}: {
  kind: "skill" | "rule" | "connector" | "expert"
  id: string
  name: string
  retired?: boolean
  onSaved: () => void
  subjects: ReturnType<typeof useSubjects>
}) {
  const [open, setOpen] = useState(false)
  const [selectOpen, setSelectOpen] = useState(false)
  const [value, setValue] = useState<AuthorizationSelection>({ groupIds: [], memberIds: [] })
  const [revision, setRevision] = useState<number | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const path = `${base}/resources/${kind}/${id}/grants`

  useEffect(() => {
    if (!open) return
    void api<{ grants: Grant[]; revision: number }>(path).then((result) => {
      setValue(selection(result.grants))
      setRevision(result.revision)
      setError("")
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "读取授权失败"))
  }, [open, path])

  const save = async () => {
    if (revision === null) return
    setSaving(true)
    setError("")
    try {
      await api(path, { method: "PUT", headers: match(revision), body: JSON.stringify({ grants: grants(value) }) })
      setOpen(false)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存授权失败")
    } finally {
      setSaving(false)
    }
  }

  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>管理授权</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{name} · 管理授权</DialogTitle></DialogHeader>
        {retired && <p className="text-sm text-amber-700">资源已退役，仅可撤销旧授权，不能新增授权。</p>}
        <AuthorizationSelect
          id={`package-grants-${kind}-${id}`}
          groups={subjects.groups}
          members={subjects.members}
          open={selectOpen}
          onOpenChange={setSelectOpen}
          title="使用授权"
          placeholder="选择分组和成员"
          value={value}
          onValueChange={setValue}
        />
        {(error || subjects.error) && <p role="alert" className="text-sm text-destructive">{error || subjects.error}</p>}
        <DialogFooter><Button disabled={saving || revision === null} type="button" onClick={() => { void save() }}>保存授权</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
