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
import { useCommonData } from "../data-provider"
import { getHostBadges } from "@/utils/common"
import { useTranslation } from "react-i18next"

interface EditGitBotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: DomainGitBot | null
  onSuccess: () => void
}

export function EditGitBotDialog({ open, onOpenChange, bot, onSuccess }: EditGitBotDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [token, setToken] = useState("")
  const [selectedHostId, setSelectedHostId] = useState<string>("")
  const [platform, setPlatform] = useState<ConstsGitPlatform>(ConstsGitPlatform.GitPlatformGitLab)
  const [loading, setLoading] = useState(false)

  const { hosts } = useCommonData()

  useEffect(() => {
    if (open && bot) {
      queueMicrotask(() => {
        setName(bot.name || "")
        setToken(bot.token || "")
        setPlatform(bot.platform || ConstsGitPlatform.GitPlatformGitLab)
        setSelectedHostId(bot.host?.id || "public_host")
      })
    }
  }, [open, bot])

  const handleSubmit = async () => {
    if (!bot?.id) {
      toast.error(t("consoleGitBot.toast.incompleteBot"))
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
        toast.success(t("consoleGitBot.toast.updateSuccess"))
        onOpenChange(false)
        onSuccess()
      } else {
        toast.error(t("consoleGitBot.toast.updateFailed", { message: resp.message }))
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
          <DialogTitle>{t("consoleGitBot.dialog.editTitle")}</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel>{t("consoleGitBot.fields.remarkName")}</FieldLabel>
          <FieldContent>
            <Input
              placeholder={t("consoleGitBot.placeholders.remarkName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              placeholder={t("consoleGitBot.placeholders.keepToken")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleGitBot.actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? t("consoleGitBot.actions.saving") : t("consoleGitBot.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
