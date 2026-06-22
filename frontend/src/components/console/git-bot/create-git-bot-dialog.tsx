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
import { useCommonData } from "../data-provider"
import { getHostBadges } from "@/utils/common"
import { useTranslation } from "react-i18next"

interface CreateGitBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (bot: DomainGitBot) => void
}

export function CreateGitBotDialog({ open, onOpenChange, onSuccess }: CreateGitBotDialogProps) {
  const { t } = useTranslation()
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform>(ConstsGitPlatform.GitPlatformGitLab)
  const [accessToken, setAccessToken] = useState("")
  const [selectedHostId, setSelectedHostId] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const { hosts } = useCommonData()

  useEffect(() => {
    if (open) {
      const defaultHost = [...hosts].sort((a) => {
        return a.status === ConstsHostStatus.HostStatusOnline ? -1 : 1
      }).find((host: DomainHost) => (
        host.status === ConstsHostStatus.HostStatusOnline
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
      toast.error(t("consoleGitBot.toast.missingAccessToken"))
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
        toast.success(t("consoleGitBot.toast.createSuccess"))
        onOpenChange(false)
        setRemark("")
        setPlatform(ConstsGitPlatform.GitPlatformGitLab)
        setAccessToken("")
        setSelectedHostId("")
        if (res.data.data && onSuccess) {
          onSuccess(res.data.data)
        }
      } else {
        toast.error(res.data.message || t("consoleGitBot.toast.createFailed"))
      }
    } catch {
      toast.error(t("consoleGitBot.toast.createFailed"))
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
          <DialogTitle>{t("consoleGitBot.dialog.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("consoleGitBot.dialog.createDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{t("consoleGitBot.fields.remark")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleGitBot.placeholders.remark")}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("consoleGitBot.fields.host")}</FieldLabel>
            <FieldContent>
              <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("consoleGitBot.placeholders.host")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={"public_host"}>
                    <div className="flex items-center gap-2">
                      <span>MonkeyCode</span>
                      <Badge variant="outline">{t("consoleGitBot.fields.builtin")}</Badge>
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
            <FieldLabel>{t("consoleGitBot.fields.platform")}</FieldLabel>
            <FieldContent>
              <Select value={platform} onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("consoleGitBot.placeholders.select")} />
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
                  <SelectItem value={ConstsGitPlatform.GitPlatformCodeup}>
                    <Icon name="Codeup" />Codeup
                  </SelectItem>
                  <SelectItem value={ConstsGitPlatform.GitPlatformCnb}>
                    <Icon name="Cnb" />CNB
                  </SelectItem>
                  <SelectItem value={ConstsGitPlatform.GitPlatformAtomGit}>
                    <Icon name="GitCode" />GitCode
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
                placeholder={t("consoleGitBot.placeholders.accessToken")}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleGitBot.actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? t("consoleGitBot.actions.creating") : t("consoleGitBot.actions.createShort")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
