import { useState, useEffect } from "react"
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
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { ConstsGitPlatform } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { CircleQuestionMark } from 'lucide-react'
import { useTranslation } from "react-i18next"

interface AddIdentityProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh?: () => void
}

export default function AddIdentity({
  open,
  onOpenChange,
  onRefresh,
}: AddIdentityProps) {
  const { t } = useTranslation()
  const [accessToken, setAccessToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform | "">("")

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

  // Set a default Base URL for the selected platform; users can still edit it for self-hosted instances.
  useEffect(() => {
    if (platform) {
      switch (platform) {
        case ConstsGitPlatform.GitPlatformGithub:
          setBaseUrl("https://github.com")
          break
        case ConstsGitPlatform.GitPlatformGitLab:
          setBaseUrl("https://gitlab.com")
          break
        case ConstsGitPlatform.GitPlatformGitea:
          setBaseUrl("https://gitea.com")
          break
        case ConstsGitPlatform.GitPlatformGitee:
          setBaseUrl("https://gitee.com")
          break
        case ConstsGitPlatform.GitPlatformCodeup:
          setBaseUrl("https://openapi-rdc.aliyuncs.com")
          break
        case ConstsGitPlatform.GitPlatformCnb:
          setBaseUrl("https://api.cnb.cool")
          break
        case ConstsGitPlatform.GitPlatformAtomgit:
          setBaseUrl("https://api.atomgit.com")
          break
        default:
          setBaseUrl("")
      }
    } else {
      setBaseUrl("")
    }
  }, [platform])

  const handleSave = () => {
    if (!accessToken.trim()) {
      toast.error(t("consoleSettings.identities.toast.accessTokenRequired"))
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

    apiRequest('v1UsersGitIdentitiesCreate', {
      access_token: accessToken.trim(),
      base_url: baseUrl.trim(),
      email: email.trim(),
      username: username.trim(),
      platform: platform as ConstsGitPlatform,
      remark: remark.trim() || undefined,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.identities.toast.addSuccess"))
        setAccessToken("")
        setBaseUrl("")
        setEmail("")
        setUsername("")
        setRemark("")
        setPlatform("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error(t("consoleSettings.identities.toast.addFailed", { message: resp.message }))
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.identities.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex gap-4">
            <Field className="flex-1">
              <FieldLabel>{t("consoleSettings.identities.labels.platformType")}</FieldLabel>
              <FieldContent>
                <Select value={platform} onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}>
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
                    <SelectItem value={ConstsGitPlatform.GitPlatformAtomgit}>
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
                  placeholder={t("consoleSettings.identities.placeholders.gitlabUrl")}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>
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
