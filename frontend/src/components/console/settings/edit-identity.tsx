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
  const [accessToken, setAccessToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [email, setEmail] = useState("")
  const [username, setUsername] = useState("")
  const [remark, setRemark] = useState("")
  const [platform, setPlatform] = useState<ConstsGitPlatform | "">("")

  const isInstallationApp = identity?.is_installation_app === true

  // 验证邮箱格式
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[a-zA-Z0-9+\-\_\.]+@[0-9a-zA-Z\.-]+$/
    return emailRegex.test(email)
  }

  // 验证用户名格式（禁止括号、引号等特殊字符，允许 Unicode 字符）
  const isValidUsername = (username: string): boolean => {
    // 禁止的字符：括号、引号、空格等
    const forbiddenChars = /[!@#$%\^\&\*\[\]\(\)\<\>'"]/
    return !forbiddenChars.test(username)
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
      toast.error("身份信息不完整")
      return
    }

    if (!baseUrl.trim()) {
      toast.error("请输入 Base URL")
      return
    }
    if (!email.trim()) {
      toast.error("请输入 Email")
      return
    }
    if (!isValidEmail(email.trim())) {
      toast.error("请输入有效的邮箱地址")
      return
    }
    if (!username.trim()) {
      toast.error("请输入用户名")
      return
    }
    if (!isValidUsername(username.trim())) {
      toast.error("用户名不能包含括号、引号等特殊字符")
      return
    }
    if (!platform) {
      toast.error("请选择 Git 平台类型")
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

    // 如果用户输入了 Access Token，则更新
    if (accessToken.trim()) {
      updateData.access_token = accessToken.trim()
    } else if (identity.access_token) {
      // 如果用户没有输入新值，但原值存在，则保持原值
      updateData.access_token = identity.access_token
    }

    apiRequest('v1UsersGitIdentitiesUpdate', updateData, [identity.id], (resp) => {
      if (resp.code === 0) {
        toast.success("身份修改成功")
        setAccessToken("")
        setBaseUrl("")
        setEmail("")
        setUsername("")
        setRemark("")
        setPlatform("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error("修改 Git 身份失败: " + resp.message)
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
          <DialogTitle>修改 Git 身份</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex gap-4">
            <Field className="flex-1">
              <FieldLabel>Git 平台类型</FieldLabel>
              <FieldContent>
                <Select
                  value={platform}
                  onValueChange={(value) => setPlatform(value as ConstsGitPlatform)}
                  disabled
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择" />
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
              <FieldLabel>Git 平台地址</FieldLabel>
              <FieldContent>
                <Input
                  placeholder="例如: https://github.com"
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
                    <CircleQuestionMark />如何获取
                  </a>
                </Button>
              </div>
              <FieldContent>
                <Input
                  placeholder="请输入 Access Token"
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
                  placeholder="请输入用户名"
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
                  placeholder="请输入邮箱地址"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>
          <Field>
            <FieldLabel>备注</FieldLabel>
            <FieldContent>
              <Input
                placeholder="可选"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
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
