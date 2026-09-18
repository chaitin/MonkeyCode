import {
  AlertCircleIcon,
  EyeOffIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import type { AuthUser } from "@/lib/auth-context"

type Methods = {
  password_enabled: boolean
  email_code_enabled: boolean
  registration_enabled: boolean
}
type Mode = "password" | "login" | "register" | "reset"

export function EmailAuthForm({
  admin = false,
  disabled = false,
  hasProviders = false,
  onAuthenticated,
  onLoginMethodsChange,
}: {
  admin?: boolean
  disabled?: boolean
  hasProviders?: boolean
  onAuthenticated: (user: AuthUser) => Promise<void> | void
  onLoginMethodsChange?: (available: boolean) => void
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [methods, setMethods] = useState<Methods | null>(null)
  const [mode, setMode] = useState<Mode>("password")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [methodsError, setMethodsError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    api<Methods>("/api/auth/v1/methods", { signal: controller.signal })
      .then((value) => {
        setMethods(value)
        setMode(value.password_enabled ? "password" : "login")
        onLoginMethodsChange?.(
          value.password_enabled || value.email_code_enabled
        )
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") {
          setMethodsError(reason.message)
          showToast({ status: "error", title: reason.message })
        }
      })
    return () => controller.abort()
  }, [onLoginMethodsChange, showToast])

  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRemaining(remaining - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [remaining])

  const changeMode = (next: Mode) => {
    setMode(next)
    setCode("")
    setPassword("")
    setShowPassword(false)
  }
  const sendCode = async () => {
    if (sending || busy || remaining > 0) return
    setSending(true)
    try {
      const result = await api<{ retry_after: number }>(
        "/api/auth/v1/email/code",
        {
          method: "POST",
          body: JSON.stringify({ email, purpose: mode }),
        }
      )
      setRemaining(result.retry_after)
      showToast({
        status: "success",
        title: t("login.sendCode", "发送验证码"),
        description: t(
          "login.codeSent",
          "如果该邮箱符合条件，验证码将发送至邮箱，请检查收件箱。"
        ),
      })
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setSending(false)
    }
  }
  const submit = async () => {
    if (busy || sending) return
    setBusy(true)
    const path =
      mode === "password"
        ? admin
          ? "admin/login"
          : "login"
        : mode === "login"
          ? admin
            ? "admin/email/login"
            : "email/login"
          : mode === "register"
            ? "email/register"
            : "email/reset-password"
    try {
      const user = await api<AuthUser>(`/api/auth/v1/${path}`, {
        method: "POST",
        body: JSON.stringify({ email, password, name, code }),
      })
      if (mode === "reset") {
        changeMode("password")
        showToast({
          status: "success",
          title: t("login.resetPassword", "重置密码"),
          description: t(
            "login.passwordReset",
            "密码已重置，请使用新密码登录。"
          ),
        })
      } else {
        await onAuthenticated(user)
      }
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const locked = disabled || busy || sending
  const canLogin = methods?.password_enabled || methods?.email_code_enabled
  const needsPassword = mode !== "login"
  const title =
    mode === "register"
      ? t("login.register", "邮箱注册")
      : mode === "reset"
        ? t("login.resetPassword", "重置密码")
        : t("login.submit")

  return (
    <div className="space-y-4">
      {!methods && !methodsError && (
        <p role="status">{t("login.loadingMethods", "正在加载登录方式…")}</p>
      )}
      {methods && !canLogin && !hasProviders && (
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
          <AlertTitle>
            {t("login.noMethodsTitle", "没有可用的登录方式")}
          </AlertTitle>
          <AlertDescription>
            {t("login.noMethods", "请联系管理员启用至少一种登录方式。")}
          </AlertDescription>
        </Alert>
      )}
      {canLogin && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <fieldset disabled={locked} className="space-y-4">
            <legend className="sr-only">{title}</legend>
            {methods &&
              ((methods.password_enabled && methods.email_code_enabled) ||
                mode === "register" ||
                mode === "reset") && (
                <Tabs
                  value={mode === "password" || mode === "login" ? mode : ""}
                  onValueChange={(value) =>
                    changeMode(value as "password" | "login")
                  }
                  className="w-full"
                >
                  <TabsList className="grid w-full auto-cols-fr grid-flow-col">
                    {methods.password_enabled && (
                      <TabsTrigger value="password">
                        {t("login.passwordLogin", "密码登录")}
                      </TabsTrigger>
                    )}
                    {methods.email_code_enabled && (
                      <TabsTrigger value="login">
                        {t("login.codeLogin", "验证码登录")}
                      </TabsTrigger>
                    )}
                  </TabsList>
                </Tabs>
              )}
            {mode === "register" && (
              <Field>
                <FieldLabel htmlFor="auth-name">
                  {t("login.name", "姓名")}
                </FieldLabel>
                <Input
                  id="auth-name"
                  autoComplete="name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="auth-email">{t("login.email")}</FieldLabel>
              <Input
                id="auth-email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setCode("")
                }}
              />
            </Field>
            {mode !== "password" && (
              <Field>
                <FieldLabel htmlFor="auth-code">
                  {t("login.code", "邮箱验证码")}
                </FieldLabel>
                <div className="relative">
                  <Input
                    id="auth-code"
                    className="pe-24"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <div className="absolute inset-y-0 end-1 flex items-center">
                    <Button
                      variant="link"
                      size="sm"
                      type="button"
                      className="h-7 px-2 text-xs"
                      disabled={remaining > 0 || !email.trim()}
                      aria-busy={sending}
                      onClick={() => void sendCode()}
                    >
                      {remaining > 0
                        ? `${remaining}s`
                        : sending
                          ? t("login.sendingCode", "发送中…")
                          : t("login.sendCode", "发送验证码")}
                    </Button>
                  </div>
                </div>
              </Field>
            )}
            {needsPassword && (
              <Field>
                <FieldLabel htmlFor="auth-password">
                  {mode === "reset"
                    ? t("login.newPassword", "新密码（至少 12 个字符）")
                    : t("login.password")}
                </FieldLabel>
                <div className="relative">
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    className="pe-10"
                    autoComplete={
                      mode === "password" ? "current-password" : "new-password"
                    }
                    required
                    minLength={mode === "password" ? undefined : 12}
                    maxLength={1024}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <div className="absolute inset-y-0 end-0.5 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={
                        showPassword
                          ? t("login.hidePassword", "隐藏密码")
                          : t("login.showPassword", "显示密码")
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      <HugeiconsIcon
                        icon={showPassword ? EyeOffIcon : ViewIcon}
                        strokeWidth={2}
                      />
                    </Button>
                  </div>
                </div>
                {mode === "register" && (
                  <p className="text-sm text-muted-foreground">
                    {t("login.passwordHint", "密码至少 12 个字符。")}
                  </p>
                )}
              </Field>
            )}
            <Button type="submit" size="lg" className="w-full" aria-busy={busy}>
              {busy ? `${title}…` : title}
            </Button>
            {!admin && methods?.registration_enabled && mode !== "register" && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => changeMode("register")}
                >
                  {t("login.register", "邮箱注册")}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      )}
    </div>
  )
}
