import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import type { DomainGitBot } from "@/api/Api"
import { useEffect, useState, useRef } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCommonData } from "../data-provider"
import { useTranslation } from "react-i18next"

interface EditGitBotPermissionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot?: DomainGitBot | null
  onSuccess?: () => void
}

export default function EditGitBotPermissionDialog({
  open,
  onOpenChange,
  bot,
  onSuccess,
}: EditGitBotPermissionDialogProps) {
  const { t } = useTranslation()
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [selectOpen, setSelectOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  const { members } = useCommonData()

  useEffect(() => {
    if (open && bot) {
      const existingIds = (bot.users || [])
        .map(u => u.id)
        .filter(Boolean) as string[]
      queueMicrotask(() => setSelectedUserIds(existingIds))
    } else if (!open) {
      queueMicrotask(() => {
        setSelectedUserIds([])
        setSelectOpen(false)
      })
    }
  }, [open, bot])

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

  const handleUserCheckboxChange = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedUserIds([...selectedUserIds, userId])
    } else {
      setSelectedUserIds(selectedUserIds.filter(id => id !== userId))
    }
  }

  const handleSave = async () => {
    if (!bot?.id) {
      toast.error(t("consoleGitBot.toast.incompleteBot"))
      return
    }

    setLoading(true)

    await apiRequest('v1UsersGitBotsShareCreate', { 
      id: bot.id,
      user_ids: selectedUserIds
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleGitBot.toast.permissionSuccess"))
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(t("consoleGitBot.toast.permissionFailed", { message: resp.message }))
      }
    })
    setLoading(false)
  }

  const handleCancel = () => {
    setSelectedUserIds([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleGitBot.permission.title")}</DialogTitle>
          <DialogDescription>
            {t("consoleGitBot.permission.description", { name: bot?.name || t("consoleGitBot.permission.fallbackBotName") })}
          </DialogDescription>
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
              {selectedUserIds.length === 0
                ? t("consoleGitBot.permission.selectMembers")
                : selectedUserIds.length === 1
                ? members.find((m) => m.id === selectedUserIds[0])?.name || 
                  members.find((m) => m.id === selectedUserIds[0])?.email ||
                  t("consoleGitBot.permission.selectedOne")
                : t("consoleGitBot.permission.selectedMany", { count: selectedUserIds.length })}
            </span>
            <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
          </Button>
          {selectOpen && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
              <div className="max-h-[200px] overflow-auto p-1">
                {members.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("consoleGitBot.permission.emptyMembers")}
                  </div>
                ) : (
                  members.map((member) => {
                    const isChecked = selectedUserIds.includes(member.id || "")
                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent cursor-pointer"
                        onClick={() => handleUserCheckboxChange(member.id || "", !isChecked)}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => handleUserCheckboxChange(member.id || "", checked as boolean)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <img 
                          src={member.avatar_url || "/logo-light.png"} 
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
            {t("consoleGitBot.actions.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleGitBot.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
