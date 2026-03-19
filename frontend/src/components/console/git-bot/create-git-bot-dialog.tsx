import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Api, ConstsGitPlatform, ConstsHostStatus } from "@/api/Api"
import { toast } from "sonner"
import type { DomainGitBot, DomainHost } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { useCommonData } from "../common-data"
import { getHostBadges } from "@/utils/common"

interface CreateGitBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (bot: DomainGitBot) => void
}

export function CreateGitBotDialog({ open, onOpenChange, onSuccess }: CreateGitBotDialogProps) {
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform>(ConstsGitPlatform.GitPlatformGitLab)
  const [accessToken, setAccessToken] = useState("")
  const [selectedHostId, setSelectedHostId] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const { hosts } = useCommonData()

  useEffect(() => {
    if (open) {
      const defaultHost = hosts.sort((a, _) => {
        return a.status === ConstsHostStatus.HostStatusOnline ? -1 : 1
      }).filter((host: DomainHost) => (
        host.status === ConstsHostStatus.HostStatusOnline
      )).find((host: DomainHost) => (
        host.is_default === true
      )) || hosts[0]
      
      if (defaultHost?.id) {
        setSelectedHostId(defaultHost?.id)
      } else {
        setSelectedHostId("public_host")
      }
    }
  }, [open, hosts])

  const handleSubmit = async () => {
    if (!accessToken) {
      toast.error("请输入 Access Token")
      return
    }
    
    setLoading(true)
    try {
      const api = new Api()
      const res = await api.api.v1UsersGitBotsCreate({
        host_id: selectedHostId,
        name: remark || undefined,
        token: accessToken,
        platform: platform,
      })
      if (res.data.code === 0) {
        toast.success("创建成功")
        onOpenChange(false)
        setRemark("")
        setPlatform(ConstsGitPlatform.GitPlatformGitLab)
        setAccessToken("")
        setSelectedHostId("")
        if (res.data.data && onSuccess) {
          onSuccess(res.data.data)
        }
      } else {
        toast.error(res.data.message || "创建失败")
      }
    } catch {
      toast.error("创建失败")
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    setRemark("")
    setPlatform(ConstsGitPlatform.GitPlatformGitLab)
    setAccessToken("")
    setSelectedHostId("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建审查机器人</DialogTitle>
          <DialogDescription>
            配置一个新的机器人来自动审查你的合并请求
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>备注</FieldLabel>
            <FieldContent>
              <Input
                placeholder="输入备注"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
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
                placeholder="请输入 Access Token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
