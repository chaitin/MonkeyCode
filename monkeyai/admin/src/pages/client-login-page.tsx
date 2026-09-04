import { useEffect, useRef, useState } from "react"
import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  ComputerIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useSearchParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { api } from "@/lib/api"
import type { AuthUser } from "@/lib/auth-context"

type Provider = { id: string; provider: string; name: string }
type ClientRequest = {
  request_id: string
  client: { client_id: string; name: string; redirect_uri: string }
  authenticated: boolean
  user: AuthUser | null
  providers: Provider[]
}

const callbackErrorMessages: Record<string, string> = {
  oauth_callback: "登录被取消或回调参数已经失效，请重新发起登录。",
  provider_unavailable: "该登录方式当前不可用，请选择其他方式。",
  oauth_exchange: "第三方身份验证失败，请重试。",
  user_unavailable: "当前账号不能登录，请联系管理员。",
  admin_password_required: "管理员账号只能使用密码登录管理后台。",
  session_failed: "登录会话创建失败，请重试。",
}

export function ClientLoginPage() {
  const [search] = useSearchParams()
  const requestId = search.get("request_id") ?? ""
  const callbackError = search.get("error") ?? ""
  const [request, setRequest] = useState<ClientRequest | null>(null)
  const [launchURL, setLaunchURL] = useState("")
  const [error, setError] = useState("")
  const completionStarted = useRef(false)
  const requestError = !requestId
    ? callbackErrorMessages[callbackError] ?? "缺少授权请求参数。"
    : callbackError
      ? callbackErrorMessages[callbackError] ?? "登录失败，请重试。"
      : error

  useEffect(() => {
    if (!requestId) return
    api<ClientRequest>(
      `/api/auth/v1/client-requests/${encodeURIComponent(requestId)}`
    )
      .then(setRequest)
      .catch((reason: Error) => setError(reason.message))
  }, [requestId])

  useEffect(() => {
    if (!request?.authenticated || completionStarted.current) return
    completionStarted.current = true
    api<{ launch_url: string }>(
      `/api/auth/v1/client-requests/${encodeURIComponent(requestId)}/complete`,
      { method: "POST" }
    )
      .then(({ launch_url }) => {
        setLaunchURL(launch_url)
        window.location.assign(launch_url)
      })
      .catch((reason: Error) => setError(reason.message))
  }, [request, requestId])

  const startLogin = (provider: Provider) => {
    const query = new URLSearchParams({ request_id: requestId })
    window.location.assign(
      `/api/auth/v1/oauth/${encodeURIComponent(provider.id)}/start?${query}`
    )
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,hsl(var(--primary)/0.14),transparent_48%)]" />
      <Card className="relative w-full max-w-md border-border/80 bg-card/95 shadow-2xl shadow-black/5 backdrop-blur">
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <HugeiconsIcon
              icon={launchURL ? CheckmarkCircle02Icon : ComputerIcon}
              strokeWidth={2}
            />
          </div>
          <CardTitle className="text-2xl">
            {launchURL
              ? "登录成功"
              : `登录 ${request?.client.name ?? "MonkeyAI"}`}
          </CardTitle>
          <CardDescription>
            {launchURL
              ? "正在返回应用，你可以关闭此页面。"
              : "浏览器只负责验证身份，授权结果会安全返回应用。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!request && !requestError && (
            <p
              className="py-5 text-center text-sm text-muted-foreground"
              role="status"
            >
              正在检查登录状态…
            </p>
          )}
          {requestError && (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {requestError}
            </p>
          )}
          {request &&
            !request.authenticated &&
            request.providers.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                size="lg"
                className="min-h-11 w-full cursor-pointer justify-between transition-colors duration-200"
                onClick={() => startLogin(provider)}
              >
                <span>使用 {provider.name} 登录</span>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
              </Button>
            ))}
          {request &&
            !request.authenticated &&
            request.providers.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                当前没有可用的登录方式，请联系管理员。
              </p>
            )}
          {request?.authenticated && !launchURL && !requestError && (
            <p
              className="py-5 text-center text-sm text-muted-foreground"
              role="status"
            >
              身份已确认，正在生成一次性授权码…
            </p>
          )}
          {launchURL && (
            <Button
              render={<a href={launchURL} />}
              size="lg"
              className="w-full cursor-pointer"
            >
              打开 {request?.client.name ?? "MonkeyAI"}
            </Button>
          )}
          <p className="pt-3 text-center text-xs text-muted-foreground">
            授权码仅可使用一次，并将在 2 分钟后失效。
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
