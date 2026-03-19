import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useState, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainGitBot } from "@/api/Api"
import { ConstsGitPlatform, ConstsHostStatus } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { useCommonData } from "../common-data"
import { getHostBadges } from "@/utils/common"

interface EditGitBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: DomainGitBot | null
  onSuccess: () => void
}

export function EditGitBotDialog({ open, onOpenChange, bot, onSuccess }: EditGitBotDialogProps) {
  const [name, setName] = useState("")
  const [token, setToken] = useState("")
  const [selectedHostId, setSelectedHostId] = useState<string>("")
  const [platform, setPlatform] = useState<ConstsGitPlatform>(ConstsGitPlatform.GitPlatformGitLab)
  const [loading, setLoading] = useState(false)

  const { hosts } = useCommonData()

  useEffect(() => {
    if (open && bot) {
      setName(bot.name || "")
      setToken(bot.token || "")
      setPlatform(bot.platform || ConstsGitPlatform.GitPlatformGitLab)
      // 设置宿主机
      if (bot.host?.id) {
        setSelectedHostId(bot.host.id)
      } else {
        setSelectedHostId("public_host")
      }
    }
  }, [open, bot])

  const handleSubmit = async () => {
    if (!bot?.id) {
      toast.error("机器人信息不完整")
      return
    }

    setLoading(true)
    await apiRequest('v1UsersGitBotsUpdate', {
      id: bot.id,
      host_id: selectedHostId,
      platform: platform,
      name: name || undefined,
      token: token || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("更新成功")
        onOpenChange(false)
        onSuccess()
      } else {
        toast.error("更新失败: " + resp.message)
      }
    })
    setLoading(false)
  }

  const handleCancel = () => {
    setName("")
    setToken("")
    setSelectedHostId("")
    setPlatform(ConstsGitPlatform.GitPlatformGitLab)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改审查机器人</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel>备注名称</FieldLabel>
          <FieldContent>
            <Input
              placeholder="输入备注名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>宿主机</FieldLabel>
          <FieldContent>
            <Select value={selectedHostId} onValueChange={setSelectedHostId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择宿主机" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"public_host"}>
                  <div className="flex items-center gap-2">
                    <span>MonkeyCode</span>
                    <Badge variant="outline">平台内置</Badge>
                  </div>
                </SelectItem>
                {hosts.map((host) => {
                  return (
                    <SelectItem key={host.id} value={host.id!} disabled={host.status !== ConstsHostStatus.HostStatusOnline}>
                      <div className="flex items-center gap-2">
                        <span>{host.remark || `${host.name}-${host.external_ip}`}</span>
                        {getHostBadges(host)}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Git 平台类型</FieldLabel>
          <FieldContent>
            <Select value={platform} onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ConstsGitPlatform.GitPlatformGitLab}>
                  <Icon name="GitLab" />GitLab
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformGithub}>
                  <Icon name="GitHub-Uncolor" />GitHub
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformGitee}>
                  <Icon name="Gitee" />Gitee
                </SelectItem>
                <SelectItem value={ConstsGitPlatform.GitPlatformGitea}>
                  <Icon name="Gitea" />Gitea
                </SelectItem>
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Access Token</FieldLabel>
          <FieldContent>
            <Input
              type="password"
              placeholder="留空则不修改"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
