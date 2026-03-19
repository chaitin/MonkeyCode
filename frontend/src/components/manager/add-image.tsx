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
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Checkbox } from "@/components/ui/checkbox"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainTeamGroup } from "@/api/Api"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface AddImageProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh?: () => void
}

export default function AddImage({
  open,
  onOpenChange,
  onRefresh,
}: AddImageProps) {
  const [imageName, setImageName] = useState("")
  const [remark, setRemark] = useState("")
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [groups, setGroups] = useState<DomainTeamGroup[]>([])
  const [selectOpen, setSelectOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  const fetchGroups = async () => {
    await apiRequest('v1TeamsGroupsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setGroups(resp.data?.groups || [])
      } else {
        toast.error("获取分组列表失败: " + resp.message);
      }
    })
  }

  useEffect(() => {
    if (open) {
      fetchGroups()
    }
  }, [open])

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

  const handleGroupCheckboxChange = (groupId: string, checked: boolean) => {
    if (checked) {
      setSelectedGroupIds([...selectedGroupIds, groupId])
    } else {
      setSelectedGroupIds(selectedGroupIds.filter(id => id !== groupId))
    }
  }

  const handleSave = () => {
    if (!imageName.trim()) {
      toast.error("请输入镜像名称")
      return
    }

    apiRequest('v1TeamsImagesCreate', { 
      name: imageName.trim(), 
      remark: remark.trim() || undefined,
      group_ids: selectedGroupIds
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("镜像绑定成功")
        setImageName("")
        setRemark("")
        setSelectedGroupIds([])
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error("绑定镜像失败: " + resp.message);
      }
    })
  }

  const handleCancel = () => {
    setImageName("")
    setRemark("")
    setSelectedGroupIds([])
    setSelectOpen(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={"outline"} size="sm">绑定</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定系统镜像</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>镜像名称</FieldLabel>
            <FieldContent>
              <Input
                placeholder="docker.io/library/ubuntu:24.04"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>备注</FieldLabel>
            <FieldContent>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>可使用该配置的分组</FieldLabel>
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
                      ? "请选择分组"
                      : selectedGroupIds.length === 1
                      ? groups.find((g) => g.id === selectedGroupIds[0])?.name || "已选择 1 个分组"
                      : `已选择 ${selectedGroupIds.length} 个分组`}
                  </span>
                  <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
                </Button>
                {selectOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="max-h-[300px] overflow-auto p-1">
                      {groups.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          暂无分组
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
            取消
          </Button>
          <Button onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

