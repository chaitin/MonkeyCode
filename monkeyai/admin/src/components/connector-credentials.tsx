import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/lib/api"
import { base, match, type Credential } from "@/lib/resources"
import { ResourceNotice } from "@/components/resource-notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Connector = {
  id: string
  name: string
  callbackURL: string
  authorizationMethod: "oauth" | "httpHeader" | null
}

export function ConnectorCredentials({
  connector,
  onClose,
  onChange,
}: {
  connector: Connector
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [name, setName] = useState("")
  const [replaceHeaders, setReplaceHeaders] = useState(false)
  const [headers, setHeaders] = useState([{ key: "Authorization", value: "" }])
  const [request, setRequest] = useState<{ id: string; url: string } | null>(
    null
  )
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const lock = useRef(false)
  const path = base + `/connectors/${connector.id}`
  const credential = credentials[0]
  const credentialPath = credential
    ? path + `/credentials/${credential.id}`
    : path + "/credentials"
  useEffect(() => {
    let cancelled = false
    api<{ items: Credential[] }>(path + "/credentials")
      .then((result) => {
        if (!cancelled) {
          setCredentials(result.items)
          setName(result.items[0]?.name ?? "")
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])
  const reload = async () => {
    const result = await api<{ items: Credential[] }>(path + "/credentials")
    setCredentials(result.items)
    setName(result.items[0]?.name ?? "")
    await onChange()
  }
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setPending(true)
    setError("")
    setNotice("")
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败")
    } finally {
      lock.current = false
      setPending(false)
    }
  }
  const test = async (id: string) => {
    try {
      await api(path + `/credentials/${id}/test`, { method: "POST" })
      setNotice(
        t("resources.credentialTestPassed", {
          defaultValue: "凭证已保存，连接测试成功。",
        })
      )
    } catch (e) {
      setNotice(
        t("resources.credentialSaved", { defaultValue: "凭证已保存。" })
      )
      throw e
    } finally {
      await reload()
    }
  }
  useEffect(() => {
    if (!request) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await api<{
          status: string
          credential_id: string | null
        }>(base + `/connector-authorizations/${request.id}`)
        if (cancelled) return
        if (result.status === "pending" || result.status === "processing") {
          timer = setTimeout(poll, 2000)
          return
        }
        setRequest(null)
        if (result.status !== "succeeded" || !result.credential_id) {
          setError(
            t("resources.authorizationFailed", {
              defaultValue: "授权未完成或已过期，请重新发起。",
            })
          )
          return
        }
        setNotice(
          t("resources.credentialSaved", { defaultValue: "凭证已保存。" })
        )
        try {
          await api(path + `/credentials/${result.credential_id}/test`, {
            method: "POST",
          })
        } catch (e) {
          if (!cancelled)
            setError(e instanceof Error ? e.message : "连接测试失败")
        }
        const updated = await api<{ items: Credential[] }>(
          path + "/credentials"
        )
        if (!cancelled) {
          setCredentials(updated.items)
          setName(updated.items[0]?.name ?? "")
        }
        await onChange()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "查询授权失败")
          setRequest(null)
        }
      }
    }
    timer = setTimeout(poll, 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request, path, onChange, t])
  const save = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const data: { name: string; http_headers?: Record<string, string> } = {
        name: name.trim(),
      }
      if (
        connector.authorizationMethod === "httpHeader" &&
        (!credential || replaceHeaders)
      ) {
        const seen = new Set<string>()
        data.http_headers = {}
        for (const header of headers) {
          const key = header.key.trim()
          if (!key || seen.has(key.toLowerCase()))
            throw new Error(
              t("resources.headerDuplicate", {
                defaultValue: "Header 名称不能为空或重复。",
              })
            )
          seen.add(key.toLowerCase())
          data.http_headers[key] = header.value
        }
      }
      const saved = await api<Credential>(credentialPath, {
        method: credential ? "PATCH" : "POST",
        headers: credential ? match(credential.revision) : {},
        body: JSON.stringify(data),
      })
      setCredentials([saved])
      setReplaceHeaders(false)
      setHeaders([{ key: "Authorization", value: "" }])
      setNotice(
        t("resources.credentialSaved", { defaultValue: "凭证已保存。" })
      )
      if (data.http_headers) await test(saved.id)
      else await reload()
    })
  }
  const authorize = () => {
    if (!name.trim() || lock.current) return
    const popup = window.open("about:blank", "_blank")
    if (popup) popup.opener = null
    void run(async () => {
      try {
        const result = await api<{ id: string; authorization_url: string }>(
          (credential ? credentialPath : path) + "/oauth/authorizations",
          {
            method: "POST",
            headers: credential ? match(credential.revision) : {},
            ...(credential
              ? {}
              : { body: JSON.stringify({ name: name.trim() }) }),
          }
        )
        setRequest({ id: result.id, url: result.authorization_url })
        if (popup) popup.location.href = result.authorization_url
      } catch (e) {
        popup?.close()
        throw e
      }
    })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            {connector.name} ·{" "}
            {t("resources.credentials", { defaultValue: "管理凭证" })}
          </DialogTitle>
          <DialogDescription>
            {t("resources.credentialNameHint", {
              defaultValue:
                "名称由你填写，用于区分凭证，不代表第三方账户身份。",
            })}
          </DialogDescription>
        </DialogHeader>
        <ResourceNotice error={error} pending={pending} loading={loading} />
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {connector.callbackURL && (
          <Field>
            <FieldLabel htmlFor="credential-callback">
              {t("resources.callbackURL")}
            </FieldLabel>
            <Input
              id="credential-callback"
              readOnly
              value={connector.callbackURL}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
        )}
        <form className="flex flex-col gap-4" onSubmit={save}>
          <Field>
            <FieldLabel htmlFor="credential-name">
              {t("resources.credentialName", { defaultValue: "凭证名称" })}
            </FieldLabel>
            <Input
              id="credential-name"
              required
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {credential && (
            <p className="text-sm text-muted-foreground">
              {t(
                credential.authorization_status === "authorized"
                  ? "pages.tools.authorized"
                  : "pages.tools.notAuthorized"
              )}{" "}
              · {t(`pages.tools.statuses.${credential.connection_status}`)}
            </p>
          )}
          {connector.authorizationMethod === "httpHeader" && (
            <>
              {credential && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={replaceHeaders}
                    onChange={(e) => setReplaceHeaders(e.target.checked)}
                  />
                  {t("resources.replaceHeaders", {
                    defaultValue: "替换全部 Header（未勾选时保留原值）",
                  })}
                </label>
              )}
              {(!credential || replaceHeaders) && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm">
                    {t("pages.tools.httpHeaders")}
                  </legend>
                  {headers.map((header, index) => (
                    <div className="flex flex-wrap gap-2" key={index}>
                      <Input
                        aria-label={t("resources.headerName", {
                          index: index + 1,
                        })}
                        className="min-w-32 flex-1"
                        required
                        value={header.key}
                        onChange={(e) =>
                          setHeaders(
                            headers.map((h, i) =>
                              i === index ? { ...h, key: e.target.value } : h
                            )
                          )
                        }
                      />
                      <Input
                        aria-label={t("resources.headerValue", {
                          index: index + 1,
                        })}
                        className="min-w-32 flex-1"
                        type="password"
                        autoComplete="new-password"
                        value={header.value}
                        onChange={(e) =>
                          setHeaders(
                            headers.map((h, i) =>
                              i === index ? { ...h, value: e.target.value } : h
                            )
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={headers.length === 1}
                        onClick={() =>
                          setHeaders(headers.filter((_, i) => i !== index))
                        }
                      >
                        {t("pages.tools.delete")}
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={headers.length >= 30}
                    onClick={() =>
                      setHeaders([...headers, { key: "", value: "" }])
                    }
                  >
                    {t("resources.addHeader", { defaultValue: "添加 Header" })}
                  </Button>
                </fieldset>
              )}
            </>
          )}
          {connector.authorizationMethod === "oauth" && credential && (
            <p className="text-sm text-muted-foreground">
              {t("resources.reauthorizeHint", {
                defaultValue:
                  "重新授权会替换这份凭证的授权内容，并重新同步工具目录。",
              })}
            </p>
          )}
          {request && (
            <p role="status" className="text-sm">
              <a
                className="underline"
                href={request.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("resources.continueAuthorization", {
                  defaultValue: "继续授权",
                })}
              </a>{" "}
              ·{" "}
              {t("resources.waitAuthorization", {
                defaultValue: "正在等待授权结果…",
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(credential || connector.authorizationMethod === "httpHeader") && (
              <Button
                type="submit"
                disabled={loading || pending || !!request || !name.trim()}
              >
                {t("pages.tools.save")}
              </Button>
            )}
            {connector.authorizationMethod === "oauth" && (
              <Button
                type="button"
                onClick={authorize}
                disabled={loading || pending || !!request || !name.trim()}
              >
                {t(
                  credential
                    ? "pages.tools.reauthorize"
                    : "pages.tools.connectAndAuthorize"
                )}
              </Button>
            )}
            {credential && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !!request}
                  onClick={() => void run(() => test(credential.id))}
                >
                  {t("pages.tools.testConnection")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !!request}
                  onClick={() =>
                    void run(async () => {
                      await api(credentialPath, {
                        method: "DELETE",
                        headers: match(credential.revision),
                      })
                      setReplaceHeaders(false)
                      await reload()
                    })
                  }
                >
                  {t("resources.revokeCredential", {
                    defaultValue: "撤销凭证",
                  })}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
