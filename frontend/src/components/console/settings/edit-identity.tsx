import { useState, useEffect } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainGitIdentity } from "@/api/Api"
import { ConstsGitPlatform } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { CircleQuestionMark } from 'lucide-react'
import { useTranslation } from "react-i18next"

interface EditIdentityProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  identity: DomainGitIdentity | null
  onRefresh?: () => void
  trigger?: React.ReactNode
}

export default function EditIdentity({
  open,
  onOpenChange,
  identity,
  onRefresh,
  trigger,
}: EditIdentityProps) {
  const { t } = useTranslation()
  const [accessToken, setAccessToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform | "">("")

  const isInstallationApp = identity?.is_installation_app === true

  // Validate email format.
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[a-zA-Z0-9+_.-]+@[0-9a-zA-Z.-]+$/
    return emailRegex.test(email)
  }

  // Validate username format while allowing Unicode characters.
  const isValidUsername = (username: string): boolean => {
    const forbiddenChars = "!@#$%^&*[]()<>'\""
    return !Array.from(forbiddenChars).some((char) => username.includes(char))
  }


  useEffect(() => {
    if (identity) {
      setUsername(identity.username || "")
      setBaseUrl(identity.base_url || "")
      setEmail(identity.email || "")
      setRemark(identity.remark || "")
      setPlatform(identity.platform || "")
      setAccessToken(identity.access_token || "")
    }
  }, [identity])

  const handleSave = () => {
    if (!identity?.id) {
      toast.error(t("consoleSettings.identities.toast.incomplete"))
      return
    }

    if (!baseUrl.trim()) {
      toast.error(t("consoleSettings.identities.toast.baseUrlRequired"))
      return
    }
    if (!email.trim()) {
      toast.error(t("consoleSettings.identities.toast.emailRequired"))
      return
    }
    if (!isValidEmail(email.trim())) {
      toast.error(t("consoleSettings.identities.toast.invalidEmail"))
      return
    }
    if (!username.trim()) {
      toast.error(t("consoleSettings.identities.toast.usernameRequired"))
      return
    }
    if (!isValidUsername(username.trim())) {
      toast.error(t("consoleSettings.identities.toast.invalidUsername"))
      return
    }
    if (!platform) {
      toast.error(t("consoleSettings.identities.toast.platformRequired"))
      return
    }

    const updateData: {
      access_token?: string
      base_url: string
      email: string
      username: string
      platform: ConstsGitPlatform
      remark?: string
    } = {
      base_url: baseUrl.trim(),
      email: email.trim(),
      username: username.trim(),
      platform: platform as ConstsGitPlatform,
      remark: remark.trim(),
    }

    // Update the token only when the user enters a new value.
    if (accessToken.trim()) {
      updateData.access_token = accessToken.trim()
    } else if (identity.access_token) {
      // Preserve the existing token when no new value is provided.
      updateData.access_token = identity.access_token
    }

    apiRequest('v1UsersGitIdentitiesUpdate', updateData, [identity.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.identities.toast.updateSuccess"))
        setAccessToken("")
        setBaseUrl("")
        setEmail("")
        setUsername("")
        setRemark("")
        setPlatform("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error(t("consoleSettings.identities.toast.updateFailed", { message: resp.message }))
      }
    })
  }

  const handleCancel = () => {
    setAccessToken("")
    setBaseUrl("")
    setEmail("")
    setUsername("")
    setRemark("")
    setPlatform("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.identities.edit.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex gap-4">
            <Field className="flex-1">
              <FieldLabel>{t("consoleSettings.identities.labels.platformType")}</FieldLabel>
              <FieldContent>
                <Select
                  value={platform}
                  onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}
                  disabled
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleSettings.identities.placeholders.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGithub}>
                      <Icon name="GitHub-Uncolor" className="fill-foreground" />GitHub
                    </SelectItem>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGitLab}>
                      <Icon name="GitLab" />GitLab
                    </SelectItem>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGitea}>
                      <Icon name="Gitea" />Gitea
                    </SelectItem>
                    <SelectItem value={ConstsGitPlatform.GitPlatformGitee}>
                      <Icon name="Gitee" />Gitee
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
            <Field className="flex-[2]">
              <FieldLabel>{t("consoleSettings.identities.labels.platformUrl")}</FieldLabel>
              <FieldContent>
                <Input
                  placeholder={t("consoleSettings.identities.placeholders.githubUrl")}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  disabled
                />
              </FieldContent>
            </Field>
          </div>
          {!isInstallationApp && (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Access Token</FieldLabel>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  asChild
                  className="h-auto p-0 text-foreground"
                >
                  <a href="https://monkeycode.docs.baizhi.cloud/node/019a95ee-6277-7412-842a-587f25330ae6" target="_blank" rel="noopener noreferrer">
                    <CircleQuestionMark />{t("consoleSettings.identities.help.howToGet")}
                  </a>
                </Button>
              </div>
              <FieldContent>
                <Input
                  placeholder={t("consoleSettings.identities.placeholders.accessToken")}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </FieldContent>
            </Field>
          )}
          <div className="flex gap-4">
            <Field className="flex-1">
              <FieldLabel>Username</FieldLabel>
              <FieldContent>
                <Input
                  placeholder={t("consoleSettings.identities.placeholders.username")}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </FieldContent>
            </Field>
            <Field className="flex-1">
              <FieldLabel>Email</FieldLabel>
              <FieldContent>
                <Input
                  type="email"
                  placeholder={t("consoleSettings.identities.placeholders.email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t("consoleSettings.identities.labels.remark")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.identities.placeholders.optional")}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t("consoleSettings.identities.actions.cancel")}
          </Button>
          <Button onClick={handleSave}>
            {t("consoleSettings.identities.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
