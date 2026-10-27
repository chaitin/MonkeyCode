import { useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  Loading03Icon,
  LockKeyIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import { EmailAuthForm } from "@/components/email-auth-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Field, FieldGroup } from "@/components/ui/field"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import type { AuthUser } from "@/lib/auth-context"
import { isSafeClientLaunchURL } from "@/lib/client-callback"
import { TABLE_DATE_TIME_OPTIONS } from "@/lib/date-time"

type Provider = { id: string; provider: string; name: string }
type ClientRequest = {
  request_id: string
  client: { client_id: string; name: string; redirect_uri: string }
  authenticated: boolean
  user: AuthUser | null
  providers: Provider[]
  scopes: string[]
  consent_required: boolean
  csrf_token: string
}

const callbackErrorMessages: Record<string, string> = {
  oauth_callback: "登录被取消或回调参数已经失效，请重新发起登录。",
  provider_unavailable: "该登录方式当前不可用，请选择其他方式。",
  oauth_exchange: "第三方身份验证失败，请重试。",
  user_unavailable: "当前账号不能登录，请联系管理员。",
  session_failed: "登录会话创建失败，请重试。",
}

export function ClientLoginPage() {
  const { t, i18n } = useTranslation()
  const { logout } = useAuth()
  const errorMessages: Record<string, string> = {
    ...callbackErrorMessages,
    seats_exceeded: t("login.seatsExceeded"),
    seats_unavailable: t("login.seatsUnavailable"),
  }
  const [search] = useSearchParams()
  const requestId = search.get("request_id") ?? ""
  const callbackError = search.get("error") ?? ""
  const [request, setRequest] = useState<ClientRequest | null>(null)
  const [productName, setProductName] = useState("MonkeyAI")
  const [workspaceName, setWorkspaceName] = useState("Monkey AI")
  const [hasEmailLogin, setHasEmailLogin] = useState(false)
  const [oauthSubmitting, setOauthSubmitting] = useState("")
  const [failedAvatarURL, setFailedAvatarURL] = useState("")
  const avatarURL = request?.user?.avatar_url?.trim() ?? ""
  const avatarSrc = avatarURL !== failedAvatarURL ? avatarURL : ""
  const [launchURL, setLaunchURL] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false)
  const [switchError, setSwitchError] = useState("")
  const pendingAction = useRef<"approve" | "switch" | null>(null)
  const lastLoginAt = request?.user?.last_login_at
    ? new Date(request.user.last_login_at)
    : null
  const requestError = !requestId
    ? (errorMessages[callbackError] ?? "缺少授权请求参数。")
    : callbackError
      ? (errorMessages[callbackError] ?? "登录失败，请重试。")
      : error

  useEffect(() => {
    const controller = new AbortController()
    api<{ product_name: string; workspace_name: string }>(
      "/api/auth/v1/branding",
      { signal: controller.signal }
    )
      .then(({ product_name, workspace_name }) => {
        if (controller.signal.aborted) return
        setProductName(product_name.trim() || "MonkeyAI")
        setWorkspaceName(workspace_name.trim() || "Monkey AI")
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!requestId) return
    const controller = new AbortController()
    api<ClientRequest>(
      `/api/auth/v1/client-requests/${encodeURIComponent(requestId)}`,
      { signal: controller.signal }
    )
      .then(setRequest)
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message)
      })
    return () => controller.abort()
  }, [requestId])

  const approve = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!request?.authenticated || pendingAction.current) return
    pendingAction.current = "approve"
    setSubmitting(true)
    setError("")
    try {
      const { launch_url } = await api<{ launch_url: string }>(
        `/api/auth/v1/client-requests/${encodeURIComponent(requestId)}/complete`,
        {
          method: "POST",
          headers: { "X-CSRF-Token": request.csrf_token },
          body: JSON.stringify({ approved_scopes: request.scopes ?? [] }),
        }
      )
      if (
        !isSafeClientLaunchURL(
          request.client.client_id,
          request.client.redirect_uri,
          launch_url
        )
      ) {
        throw new Error("授权回调地址校验失败，请从客户端重新发起登录。")
      }
      setLaunchURL(launch_url)
      window.location.assign(launch_url)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "授权失败，请重试。")
      pendingAction.current = null
    } finally {
      setSubmitting(false)
    }
  }

  const switchAccount = async () => {
    if (!request?.authenticated || pendingAction.current) return
    pendingAction.current = "switch"
    setSwitchingAccount(true)
    setError("")
    setSwitchError("")
    let loggedOut = false
    try {
      await logout()
      loggedOut = true
      setSwitchDialogOpen(false)
      setRequest(null)
      setHasEmailLogin(false)
      setOauthSubmitting("")
      setFailedAvatarURL("")
      const nextRequest = await api<ClientRequest>(
        `/api/auth/v1/client-requests/${encodeURIComponent(requestId)}`
      )
      setRequest(nextRequest)
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "切换账号失败，请重试。"
      if (loggedOut) setError(message)
      else setSwitchError(message)
    } finally {
      pendingAction.current = null
      setSwitchingAccount(false)
    }
  }

  const startLogin = (provider: Provider) => {
    if (oauthSubmitting) return
    setOauthSubmitting(provider.id)
    const query = new URLSearchParams({ request_id: requestId })
    try {
      window.location.assign(
        `/api/auth/v1/oauth/${encodeURIComponent(provider.id)}/start?${query}`
      )
    } catch (reason) {
      setOauthSubmitting("")
      setError(reason instanceof Error ? reason.message : "登录失败，请重试。")
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgb(var(--primary-rgb)/0.14),transparent_48%)]" />
      <Card className="relative w-full max-w-md gap-6 border-border/80 bg-card/95 py-6 shadow-2xl shadow-black/5 backdrop-blur">
        <CardHeader className="items-center px-8 text-center">
          <div className="mx-auto mb-5 flex max-w-full items-center justify-center gap-3">
            <img
              key={avatarURL}
              src={avatarSrc || "/monkeyai-logo.webp"}
              alt={avatarSrc ? request?.user?.name || "用户头像" : productName}
              width={48}
              height={48}
              className="size-12 shrink-0 rounded-md object-cover"
              onError={
                avatarSrc ? () => setFailedAvatarURL(avatarSrc) : undefined
              }
            />
          </div>
          <CardDescription className="text-base text-foreground">
            {launchURL ? (
              "登录成功，正在返回应用，你可以关闭此页面。"
            ) : (
              <>
                <strong className="mx-1 font-semibold">{productName}</strong>
                即将登录到
                <strong className="mx-1 font-semibold">{workspaceName}</strong>
                的团队空间
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-8">
          {!request && !requestError && (
            <p
              className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground"
              role="status"
            >
              <HugeiconsIcon
                icon={Loading03Icon}
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              正在检查登录状态
            </p>
          )}
          {requestError && (
            <Alert>
              <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
              <AlertTitle>授权请求访问失败</AlertTitle>
              <AlertDescription>
                {requestError === "授权请求不存在、已完成或已过期" ||
                requestError === "授权请求不存在"
                  ? "授权请求可能不存在、已完成或已过期。请返回客户端重新发起登录。"
                  : requestError}
              </AlertDescription>
            </Alert>
          )}
          {request && !request.authenticated && (
            <FieldGroup className="w-full">
              <EmailAuthForm
                disabled={Boolean(oauthSubmitting)}
                hasProviders={request.providers.length > 0}
                onLoginMethodsChange={setHasEmailLogin}
                onAuthenticated={() =>
                  api<ClientRequest>(
                    `/api/auth/v1/client-requests/${encodeURIComponent(requestId)}`
                  )
                    .then(setRequest)
                    .catch((reason: Error) => setError(reason.message))
                }
              />
              {request.providers.length > 0 && (
                <>
                  {hasEmailLogin && (
                    <Marker variant="separator">
                      <MarkerContent>
                        {t("login.otherLoginMethods")}
                      </MarkerContent>
                    </Marker>
                  )}
                  <Field className="flex flex-col gap-3">
                    {request.providers.map((provider) => (
                      <Button
                        key={provider.id}
                        variant="outline"
                        size="lg"
                        type="button"
                        className="w-full min-w-0"
                        disabled={Boolean(oauthSubmitting)}
                        aria-busy={oauthSubmitting === provider.id}
                        aria-label={t("login.loginWith", {
                          provider: provider.name,
                        })}
                        title={provider.name}
                        onClick={() => startLogin(provider)}
                      >
                        <HugeiconsIcon
                          aria-hidden="true"
                          icon={
                            oauthSubmitting === provider.id
                              ? Loading03Icon
                              : LockKeyIcon
                          }
                          className={
                            oauthSubmitting === provider.id
                              ? "animate-spin motion-reduce:animate-none"
                              : undefined
                          }
                          strokeWidth={2}
                        />
                        <span className="truncate">{provider.name}</span>
                      </Button>
                    ))}
                  </Field>
                </>
              )}
            </FieldGroup>
          )}
          {request?.authenticated && !launchURL && (
            <form onSubmit={approve} className="space-y-8">
              <dl className="divide-y divide-input rounded-md border border-input bg-transparent text-sm shadow-xs dark:bg-input/30">
                <div className="flex items-baseline gap-3 px-5 py-2.5">
                  <dt className="w-16 shrink-0 text-left text-muted-foreground">
                    姓名
                  </dt>
                  <dd className="min-w-0 flex-1 select-text break-all text-right">
                    {request.user?.name || "—"}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 px-5 py-2.5">
                  <dt className="w-16 shrink-0 text-left text-muted-foreground">
                    账号
                  </dt>
                  <dd className="min-w-0 flex-1 select-text break-all text-right">
                    {request.user?.email || "—"}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 px-5 py-2.5">
                  <dt className="w-16 shrink-0 text-left text-muted-foreground">
                    上次登录
                  </dt>
                  <dd className="min-w-0 flex-1 select-text break-all text-right">
                    {lastLoginAt && !Number.isNaN(lastLoginAt.getTime())
                      ? lastLoginAt.toLocaleString(
                          i18n.resolvedLanguage ?? i18n.language,
                          TABLE_DATE_TIME_OPTIONS
                        )
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div className="space-y-2">
                <Button
                  type="submit"
                  size="lg"
                  className="min-h-11 w-full cursor-pointer"
                  disabled={switchingAccount}
                  loading={submitting}
                >
                  确认授权
                </Button>
                <AlertDialog
                  open={switchDialogOpen}
                  onOpenChange={(open) => {
                    if (pendingAction.current) return
                    setSwitchDialogOpen(open)
                    if (open) setSwitchError("")
                  }}
                >
                  <AlertDialogTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="min-h-11 w-full cursor-pointer"
                        disabled={submitting || switchingAccount}
                      />
                    }
                  >
                    切换账号
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>切换账号</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogDescription>
                      当前账号将要登出。确认后可使用其他账号继续本次授权。
                    </AlertDialogDescription>
                    {switchError && (
                      <Alert>
                        <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
                        <AlertTitle>退出登录失败</AlertTitle>
                        <AlertDescription>{switchError}</AlertDescription>
                      </Alert>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancel
                        type="button"
                        disabled={switchingAccount}
                      >
                        取消
                      </AlertDialogCancel>
                      <AlertDialogAction
                        type="button"
                        loading={switchingAccount}
                        onClick={() => void switchAccount()}
                      >
                        确认登出
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </form>
          )}
          {launchURL && (
            <Button
              nativeButton={false}
              render={<a href={launchURL} />}
              size="lg"
              className="w-full cursor-pointer"
            >
              打开 {request?.client.name ?? "MonkeyAI"}
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
