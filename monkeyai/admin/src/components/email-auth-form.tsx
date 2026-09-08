import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
}: {
  admin?: boolean
  disabled?: boolean
  hasProviders?: boolean
  onAuthenticated: (user: AuthUser) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [methods, setMethods] = useState<Methods | null>(null)
  const [mode, setMode] = useState<Mode>("password")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    api<Methods>("/api/auth/v1/methods", { signal: controller.signal })
      .then((value) => {
        setMethods(value)
        setMode(value.password_enabled ? "password" : "login")
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setRemaining(remaining - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [remaining])

  const changeMode = (next: Mode) => {
    setMode(next)
    setCode("")
    setPassword("")
    setError("")
    setMessage("")
  }
  const sendCode = async () => {
    if (sending || busy || remaining > 0) return
    setSending(true)
    setError("")
    setMessage("")
    try {
      const result = await api<{ retry_after: number }>(
        "/api/auth/v1/email/code",
        {
          method: "POST",
          body: JSON.stringify({ email, purpose: mode }),
        }
      )
      setRemaining(result.retry_after)
      setMessage(
        t(
          "login.codeSent",
          "如果该邮箱符合条件，验证码将发送至邮箱，请检查收件箱。"
        )
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSending(false)
    }
  }
  const submit = async () => {
    if (busy || sending) return
    setBusy(true)
    setError("")
    setMessage("")
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
        setMessage(t("login.passwordReset", "密码已重置，请使用新密码登录。"))
      } else {
        await onAuthenticated(user)
      }
    } catch (reason) {
      setError((reason as Error).message)
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
      {!methods && !error && (
        <p role="status">{t("login.loadingMethods", "正在加载登录方式…")}</p>
      )}
      {methods && !canLogin && !hasProviders && (
        <p role="status">
          {t("login.noMethods", "当前没有可用的登录方式，请联系管理员。")}
        </p>
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
                  setMessage("")
                }}
              />
            </Field>
            {mode !== "password" && (
              <Field>
                <FieldLabel htmlFor="auth-code">
                  {t("login.code", "邮箱验证码")}
                </FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="auth-code"
                    className="min-w-0"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    type="button"
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
              </Field>
            )}
            {needsPassword && (
              <Field>
                <FieldLabel htmlFor="auth-password">
                  {mode === "reset"
                    ? t("login.newPassword", "新密码（至少 12 个字符）")
                    : t("login.password")}
                </FieldLabel>
                <Input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === "password" ? "current-password" : "new-password"
                  }
                  required
                  minLength={mode === "password" ? undefined : 12}
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
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
            <div className="flex flex-wrap justify-center gap-2">
              {methods?.password_enabled && mode !== "password" && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => changeMode("password")}
                >
                  {t("login.passwordLogin", "密码登录")}
                </Button>
              )}
              {methods?.email_code_enabled && mode !== "login" && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => changeMode("login")}
                >
                  {t("login.codeLogin", "验证码登录")}
                </Button>
              )}
              {!admin &&
                methods?.registration_enabled &&
                mode !== "register" && (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => changeMode("register")}
                  >
                    {t("login.register", "邮箱注册")}
                  </Button>
                )}
              {methods?.password_enabled && mode !== "reset" && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => changeMode("reset")}
                >
                  {t("login.forgotPassword")}
                </Button>
              )}
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  )
}
