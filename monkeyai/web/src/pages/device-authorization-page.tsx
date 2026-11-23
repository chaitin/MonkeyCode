import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { EmailAuthForm } from "@/components/email-auth-form"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { AuthUser } from "@/lib/auth-context"

type DeviceRequest = {
  request_id: string
  client: { name: string }
  authenticated: boolean
  user: AuthUser | null
  providers: { id: string; name: string }[]
  display_name: string
  machine_id: string
  platform: string
  arch: string
  key_fingerprint: string
  scopes: string[]
  scope_descriptions: Record<string, string>
  expires_at: string
  status: string
  csrf_token: string
  requires_restore: boolean
  registration_conflict: boolean
}

function getDeviceRequest(id: string, userCode: string) {
  const query = new URLSearchParams({ purpose: "device" })
  if (userCode) query.set("user_code", userCode)
  return api<DeviceRequest>(
    `/api/auth/v1/client-requests/${encodeURIComponent(id || "device")}?${query}`
  )
}

export function DeviceAuthorizationPage() {
  const [search] = useSearchParams()
  const requestId = search.get("request_id") ?? ""
  const initialCode = search.get("user_code") ?? ""
  return (
    <DeviceAuthorizationForm
      key={`${requestId}/${initialCode}`}
      requestId={requestId}
      initialCode={initialCode}
    />
  )
}

function DeviceAuthorizationForm({
  requestId,
  initialCode,
}: {
  requestId: string
  initialCode: string
}) {
  const [code, setCode] = useState(initialCode)
  const [request, setRequest] = useState<DeviceRequest | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(Boolean(requestId || initialCode))
  const [restore, setRestore] = useState(false)
  const [result, setResult] = useState("")

  const load = async (id: string, userCode: string) => {
    setLoading(true)
    setError("")
    try {
      const data = await getDeviceRequest(id, userCode)
      setRequest(data)
      setRestore(false)
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "设备授权申请不可用。"
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!requestId && !initialCode) return
    let active = true
    getDeviceRequest(requestId, initialCode)
      .then((data) => {
        if (active) setRequest(data)
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [requestId, initialCode])

  const decide = async (decision: "approve" | "deny") => {
    if (!request || loading) return
    setLoading(true)
    setError("")
    try {
      await api("/api/auth/v1/device/decision", {
        method: "POST",
        headers: { "X-CSRF-Token": request.csrf_token },
        body: JSON.stringify({
          request_id: request.request_id,
          decision,
          approved_scopes: request.scopes,
          restore_revoked: restore,
        }),
      })
      setResult(
        decision === "approve"
          ? "设备授权已批准，请返回执行设备完成连接。"
          : "已拒绝此设备的授权申请。"
      )
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "无法保存设备授权决定。"
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <meta name="referrer" content="no-referrer" />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>授权执行设备</CardTitle>
          <CardDescription>
            确认设备名称和权限，只批准你刚刚发起的登录申请。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!request && !result && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                void load("", code)
              }}
            >
              <label className="text-sm font-medium" htmlFor="device-code">
                设备上显示的验证码
              </label>
              <Input
                id="device-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="ABCD-EFGH"
                autoComplete="one-time-code"
                maxLength={16}
                disabled={loading}
              />
              <Button
                type="submit"
                className="min-h-11 w-full"
                disabled={loading || !code.trim()}
              >
                {loading ? "正在查询…" : "查询设备"}
              </Button>
            </form>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {result && (
            <p role="status" className="rounded-md bg-muted p-4 text-sm">
              {result}
            </p>
          )}
          {request && !result && (
            <>
              <div className="space-y-2 rounded-md border p-4 text-sm">
                <p className="font-medium">{request.display_name}</p>
                <p className="text-muted-foreground">
                  {request.platform} · {request.arch}
                </p>
                <p className="break-all text-muted-foreground">
                  设备公钥指纹：{request.key_fingerprint}
                </p>
                <p className="text-muted-foreground">
                  有效至 {new Date(request.expires_at).toLocaleString()}
                </p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {request.scopes.map((scope) => (
                  <li key={scope}>
                    {request.scope_descriptions[scope] ?? scope}
                  </li>
                ))}
              </ul>
              {request.status !== "pending" && (
                <p role="status" className="text-sm text-muted-foreground">
                  此申请已处理，请在设备上查询结果或重新申请。
                </p>
              )}
              {!request.authenticated &&
                request.providers.map((provider) => (
                  <Button
                    key={provider.id}
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={() => {
                      const query = new URLSearchParams({
                        purpose: "device",
                        request_id: request.request_id,
                      })
                      window.location.assign(
                        `/api/auth/v1/oauth/${encodeURIComponent(provider.id)}/start?${query}`
                      )
                    }}
                  >
                    使用 {provider.name} 登录
                  </Button>
                ))}
              {!request.authenticated && (
                <EmailAuthForm
                  hasProviders={request.providers.length > 0}
                  onAuthenticated={() => {
                    void load(request.request_id, "")
                  }}
                />
              )}
              {request.authenticated && request.status === "pending" && (
                <>
                  <p className="text-sm">
                    授权账号：{request.user?.email ?? request.user?.name}
                  </p>
                  {request.registration_conflict && (
                    <p role="alert" className="text-sm text-destructive">
                      此设备与已登记公钥冲突，不能覆盖原设备身份。
                    </p>
                  )}
                  {request.requires_restore && (
                    <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                      <Checkbox
                        className="mt-1"
                        checked={restore}
                        onCheckedChange={(checked) =>
                          setRestore(checked === true)
                        }
                        disabled={loading}
                      />
                      <span>
                        此设备的远程访问已撤销。我确认重新授权并恢复远程访问。
                      </span>
                    </label>
                  )}
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1"
                      disabled={loading}
                      onClick={() => {
                        void decide("deny")
                      }}
                    >
                      拒绝
                    </Button>
                    <Button
                      className="min-h-11 flex-1"
                      disabled={
                        loading ||
                        request.registration_conflict ||
                        (request.requires_restore && !restore)
                      }
                      onClick={() => {
                        void decide("approve")
                      }}
                    >
                      {loading ? "正在保存…" : "批准授权"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
