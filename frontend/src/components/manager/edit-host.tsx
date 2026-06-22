import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainTeamGroup } from "@/api/Api"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

interface EditHostProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  host: { id: string; name: string; external_ip: string; remark?: string; groups?: DomainTeamGroup[] } | null
  onRefresh?: () => void
  trigger?: React.ReactNode
}

export default function EditHost({
  open,
  onOpenChange,
  host,
  onRefresh,
  trigger,
}: EditHostProps) {
  const { t } = useTranslation()
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [groups, setGroups] = useState<DomainTeamGroup[]>([])
  const [selectOpen, setSelectOpen] = useState(false)
  const [remark, setRemark] = useState("")
  const selectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      fetchGroups()
    }
  }, [open])

  useEffect(() => {
    if (host) {
      setSelectedGroupIds(host.groups?.map(g => g.id || "").filter(id => id) || [])
      setRemark(host.remark || "")
    }
  }, [host])

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

  const fetchGroups = async () => {
    await apiRequest('v1TeamsGroupsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setGroups(resp.data?.groups || [])
      } else {
        toast.error(t("managerHosts.toast.groupFetchFailedWithMessage", { message: resp.message }));
      }
    })
  }

  const handleGroupCheckboxChange = (groupId: string, checked: boolean) => {
    if (checked) {
      setSelectedGroupIds([...selectedGroupIds, groupId])
    } else {
      setSelectedGroupIds(selectedGroupIds.filter(id => id !== groupId))
    }
  }

  const handleSave = () => {
    if (!host?.id) {
      toast.error(t("managerHosts.toast.incompleteHost"))
      return
    }

    apiRequest('v1TeamsHostsUpdate', { 
      group_ids: selectedGroupIds,
      remark: remark
    }, [host.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerHosts.toast.hostUpdated"))
        setSelectedGroupIds([])
        setRemark("")
        setSelectOpen(false)
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error(t("managerHosts.toast.updateHostFailedWithMessage", { message: resp.message }));
      }
    })
  }

  const handleCancel = () => {
    setSelectedGroupIds([])
    setRemark("")
    setSelectOpen(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("managerHosts.edit.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>{t("managerHosts.edit.host")}</FieldLabel>
            <FieldContent>
              <div className="text-sm text-muted-foreground">
                {host?.remark || `${host?.name}-${host?.external_ip}`}
              </div>
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("managerHosts.edit.remark")}</FieldLabel>
            <FieldContent>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("managerHosts.edit.remarkPlaceholder")}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("managerHosts.edit.groups")}</FieldLabel>
            <FieldContent>
              <div className="relative" ref={selectRef}>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={selectOpen}
                  className="w-full justify-between"
                  onClick={() => setSelectOpen(!selectOpen)}
                >
                  <span className="truncate">
                    {selectedGroupIds.length === 0
                      ? t("managerHosts.groups.select")
                      : selectedGroupIds.length === 1
                      ? groups.find((g) => g.id === selectedGroupIds[0])?.name || t("managerHosts.groups.selectedOne")
                      : t("managerHosts.groups.selectedMany", { count: selectedGroupIds.length })}
                  </span>
                  <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
                </Button>
                {selectOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="max-h-[300px] overflow-auto p-1">
                      {groups.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          {t("managerHosts.groups.empty")}
                        </div>
                      ) : (
                        groups.map((group) => {
                          const isChecked = selectedGroupIds.includes(group.id || "")
                          return (
                            <div
                              key={group.id}
                              className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent cursor-pointer"
                              onClick={() => handleGroupCheckboxChange(group.id || "", !isChecked)}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => handleGroupCheckboxChange(group.id || "", checked as boolean)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-sm">{group.name}</span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("managerHosts.actions.cancel")}
          </Button>
          <Button onClick={handleSave}>
            {t("managerHosts.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
