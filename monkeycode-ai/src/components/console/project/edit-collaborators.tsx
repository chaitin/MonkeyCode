import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import type { DomainProject, ConstsProjectCollaboratorRole, DomainCreateCollaboratorItem } from "@/api/Api"
import { useEffect, useState, useRef } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCommonData } from "../data-provider"

interface EditCollaboratorsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject | null
  onSuccess?: () => void
}

export default function EditCollaboratorsDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: EditCollaboratorsDialogProps) {
  const [selectedCollaboratorIds, setSelectedCollaboratorIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [selectOpen, setSelectOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  const { members } = useCommonData()

  useEffect(() => {
    if (open && project) {
      // 加载已有的协作者
      const existingIds = (project.collaborators || [])
        .map(c => c.id)
        .filter(Boolean) as string[]
      setSelectedCollaboratorIds(existingIds)
    } else if (!open) {
      setSelectedCollaboratorIds([])
      setSelectOpen(false)
    }
  }, [open, project])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setSelectOpen(false)
      }
    }

    if (selectOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [selectOpen])

  const handleCollaboratorCheckboxChange = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedCollaboratorIds([...selectedCollaboratorIds, userId])
    } else {
      setSelectedCollaboratorIds(selectedCollaboratorIds.filter(id => id !== userId))
    }
  }

  const handleSave = async () => {
    setLoading(true)

    // 构建协作者列表
    const collaborators: DomainCreateCollaboratorItem[] = selectedCollaboratorIds.map(userId => ({
      user_id: userId,
      permission: "read_write" as ConstsProjectCollaboratorRole
    }))

    await apiRequest('v1UsersProjectsUpdate', { 
      collaborators
    }, [project?.id!], (resp) => {
        if (resp.code === 0) {
          toast.success("协作成员修改成功")
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error("修改协作成员失败: " + resp.message)
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    setSelectedCollaboratorIds([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改成员</DialogTitle>
        </DialogHeader>
        <div className="relative" ref={selectRef}>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={selectOpen}
            className="w-full justify-between"
            onClick={() => setSelectOpen(!selectOpen)}
            disabled={loading}
          >
            <span className="truncate">
              {selectedCollaboratorIds.length === 0
                ? "请选择协作成员"
                : selectedCollaboratorIds.length === 1
                ? members.find((m) => m.id === selectedCollaboratorIds[0])?.name || 
                  members.find((m) => m.id === selectedCollaboratorIds[0])?.email ||
                  "已选择 1 名成员"
                : `已选择 ${selectedCollaboratorIds.length} 名成员`}
            </span>
            <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
          </Button>
          {selectOpen && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
              <div className="max-h-[200px] overflow-auto p-1">
                {members.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    暂无可选的协作成员
                  </div>
                ) : (
                  members.map((member) => {
                    const isChecked = selectedCollaboratorIds.includes(member.id || "")
                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent cursor-pointer"
                        onClick={() => handleCollaboratorCheckboxChange(member.id || "", !isChecked)}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => handleCollaboratorCheckboxChange(member.id || "", checked as boolean)}
                          onClick={(e) => e.stopPropagation()}
                        />
                          <img 
                            src={member.avatar_url || "/logo-colored.png"} 
                            alt={member.name || ''} 
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        <span className="text-sm truncate">{member.name || member.email}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

