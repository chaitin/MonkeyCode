import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react"
import { useTranslation } from "react-i18next"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"
import { base, match, type Credential } from "@/lib/resources"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"

export type CredentialConnector = {
  id: string
  name: string
  callbackURL: string
  authorizationMethod: "oauth" | "httpHeader" | null
  credentials: Credential[]
}

export type ConnectorCredentialInput = {
  id?: string
  revision?: number
  name?: string
  http_headers?: Record<string, string>
  revoke?: true
}

export type ConnectorCredentialsHandle = {
  validate: () => void
  getValue: () => ConnectorCredentialInput | undefined
  accept: (
    connector: CredentialConnector,
    written?: ConnectorCredentialInput
  ) => void
}

export function ConnectorCredentials({
  ref,
  connector,
  method,
  active,
  disabled,
  onPrepare,
  onChange,
  onRevoke,
  onBusyChange,
}: {
  ref: Ref<ConnectorCredentialsHandle>
  connector: CredentialConnector | null
  method: "oauth" | "httpHeader"
  active: boolean
  disabled: boolean
  onPrepare: () => Promise<CredentialConnector | null>
  onChange: (id: string) => Promise<CredentialConnector>
  onRevoke: (
    change: ConnectorCredentialInput
  ) => Promise<CredentialConnector | null>
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [credential, setCredential] = useState<Credential | null>(
    () => connector?.credentials[0] ?? null
  )
  const credentialRef = useRef(credential)
  const [credentialMethod, setCredentialMethod] = useState(
    connector?.authorizationMethod ?? null
  )
  const [name, setName] = useState(credential?.name ?? "")
  const [replaceHeaders, setReplaceHeaders] = useState(false)
  const [headers, setHeaders] = useState([{ key: "Authorization", value: "" }])
  const [request, setRequest] = useState<{
    id: string
    url: string
    connectorID: string
  } | null>(null)
  const [operation, setOperation] = useState<
    "authorize" | "test" | "revoke" | null
  >(null)
  const pending = operation !== null
  const lock = useRef(false)
  const writeHeaders =
    !credential || replaceHeaders || credentialMethod === "oauth"

  const acceptCredential = useCallback((saved: Credential | null) => {
    credentialRef.current = saved
    setCredential(saved)
  }, [])

  const currentCredential = (target: CredentialConnector) => {
    const stored = target.credentials[0]
    const cached = credentialRef.current
    if (cached?.connector_id !== target.id) return stored ?? null
    return stored &&
      (stored.id !== cached.id || stored.revision >= cached.revision)
      ? stored
      : cached
  }

  const validate = () => {
    if (!name.trim()) throw new Error(t("resources.credentialNameRequired"))
    if (method === "httpHeader" && writeHeaders) {
      const seen = new Set<string>()
      for (const header of headers) {
        const key = header.key.trim().toLowerCase()
        if (!key || seen.has(key))
          throw new Error(t("resources.headerDuplicate"))
        seen.add(key)
      }
    }
  }

  const getValue = (): ConnectorCredentialInput | undefined => {
    validate()
    const data: ConnectorCredentialInput = { name: name.trim() }
    if (credential) {
      data.id = credential.id
      data.revision = credential.revision
    }
    if (method === "httpHeader" && writeHeaders) {
      data.http_headers = Object.fromEntries(
        headers.map((header) => [header.key.trim(), header.value])
      )
    }
    if (credential && !data.http_headers && data.name === credential.name)
      return undefined
    return data
  }

  const accept = (
    target: CredentialConnector,
    written?: ConnectorCredentialInput
  ) => {
    const saved = target.credentials[0] ?? null
    acceptCredential(saved)
    if (saved) setCredentialMethod(target.authorizationMethod)
    if (written?.name && saved) setName(saved.name)
    if (written?.http_headers || written?.revoke) {
      setReplaceHeaders(false)
      setHeaders([{ key: "Authorization", value: "" }])
    }
    if (written && saved?.connection_status === "error") {
      showToast({
        status: "error",
        title: saved.last_error ?? t("resources.credentialConnectionFailed"),
        description: t("resources.credentialSaved"),
      })
    }
  }

  useImperativeHandle(ref, () => ({ validate, getValue, accept }))

  const run = async (
    action: () => Promise<void>,
    kind: "authorize" | "test" | "revoke"
  ) => {
    if (lock.current) return
    lock.current = true
    setOperation(kind)
    onBusyChange(true)
    try {
      await action()
    } catch (error) {
      showToast({
        status: "error",
        title: error instanceof Error ? error.message : String(error),
      })
    } finally {
      lock.current = false
      setOperation(null)
      onBusyChange(false)
    }
  }

  useEffect(() => {
    if (!request || !active || method !== "oauth") return
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
        if (result.status !== "succeeded" || !result.credential_id) {
          setRequest(null)
          showToast({
            status: "error",
            title: t("resources.authorizationFailed"),
          })
          return
        }
        const updated = await api<{ items: Credential[] }>(
          base + `/connectors/${request.connectorID}/credentials`
        )
        if (cancelled) return
        const saved =
          updated.items.find((item) => item.id === result.credential_id) ?? null
        acceptCredential(saved)
        setCredentialMethod("oauth")
        setRequest(null)
        if (!saved) {
          showToast({
            status: "error",
            title: t("resources.authorizationFailed"),
          })
          await onChange(request.connectorID)
          return
        }
        setName(saved.name)
        if (saved?.connection_status === "error") {
          showToast({
            status: "error",
            title:
              saved.last_error ?? t("resources.credentialConnectionFailed"),
            description: t("resources.credentialSaved"),
          })
        } else {
          showToast({
            status: "success",
            title: t(
              saved?.connection_status === "connected"
                ? "resources.credentialTestPassed"
                : "resources.credentialSaved"
            ),
          })
        }
        await onChange(request.connectorID)
      } catch (error) {
        if (!cancelled) {
          showToast({
            status: "error",
            title: error instanceof Error ? error.message : String(error),
          })
          setRequest(null)
        }
      }
    }
    timer = setTimeout(poll, 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request, active, method, onChange, showToast, t, acceptCredential])

  const authorize = () => {
    if (!name.trim() || lock.current) return
    const popup = window.open("about:blank", "_blank")
    if (popup) popup.opener = null
    void run(async () => {
      let target: CredentialConnector | null
      try {
        target = await onPrepare()
        if (!target) {
          popup?.close()
          return
        }
        const path = base + `/connectors/${target.id}`
        const credential = currentCredential(target)
        const result = await api<{ id: string; authorization_url: string }>(
          (credential ? path + `/credentials/${credential.id}` : path) +
            "/oauth/authorizations",
          {
            method: "POST",
            headers: credential ? match(credential.revision) : {},
            ...(credential
              ? {}
              : { body: JSON.stringify({ name: name.trim() }) }),
          }
        )
        setRequest({
          id: result.id,
          url: result.authorization_url,
          connectorID: target.id,
        })
        if (popup) popup.location.href = result.authorization_url
      } catch (error) {
        popup?.close()
        throw error
      }
      // DCR may update the connector revision before the OAuth flow completes.
      await onChange(target.id)
    }, "authorize")
  }

  return (
    <fieldset
      disabled={disabled || pending || !active}
      className={
        active ? "flex min-w-0 flex-col gap-4 border-t pt-4" : "hidden"
      }
    >
      <Field>
        <FieldLabel htmlFor="credential-name">
          {t("resources.credentialName")}
        </FieldLabel>
        <Input
          id="credential-name"
          required
          maxLength={128}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldDescription>{t("resources.credentialNameHint")}</FieldDescription>
      </Field>
      {credential && (
        <p className="text-sm text-muted-foreground" role="status">
          {t(
            credential.authorization_status === "authorized"
              ? "pages.tools.authorized"
              : "pages.tools.notAuthorized"
          )}{" "}
          · {t(`pages.tools.statuses.${credential.connection_status}`)}
          {credential.last_error && (
            <span className="mt-1 block text-destructive">
              {credential.last_error}
            </span>
          )}
        </p>
      )}
      {method === "httpHeader" && (
        <>
          {credential && credentialMethod !== "oauth" && (
            <Field orientation="horizontal">
              <Checkbox
                id="replace-credential-headers"
                checked={replaceHeaders}
                onCheckedChange={setReplaceHeaders}
              />
              <FieldLabel htmlFor="replace-credential-headers">
                {t("resources.replaceHeaders")}
              </FieldLabel>
            </Field>
          )}
          {writeHeaders && (
            <Field>
              <FieldLabel>{t("pages.tools.httpHeaders")}</FieldLabel>
              <div className="flex min-w-0 flex-col gap-2">
                {headers.map((header, index) => (
                  <div className="flex min-w-0 flex-wrap gap-2" key={index}>
                    <Input
                      aria-label={t("resources.headerName", {
                        index: index + 1,
                      })}
                      className="min-w-24 flex-1"
                      required
                      value={header.key}
                      onChange={(event) =>
                        setHeaders(
                          headers.map((item, i) =>
                            i === index
                              ? { ...item, key: event.target.value }
                              : item
                          )
                        )
                      }
                    />
                    <Input
                      aria-label={t("resources.headerValue", {
                        index: index + 1,
                      })}
                      className="min-w-24 flex-1"
                      type="password"
                      autoComplete="new-password"
                      value={header.value}
                      onChange={(event) =>
                        setHeaders(
                          headers.map((item, i) =>
                            i === index
                              ? { ...item, value: event.target.value }
                              : item
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
                  className="self-start"
                  type="button"
                  variant="outline"
                  disabled={headers.length >= 30}
                  onClick={() =>
                    setHeaders([...headers, { key: "", value: "" }])
                  }
                >
                  {t("resources.addHeader")}
                </Button>
              </div>
            </Field>
          )}
        </>
      )}
      {method === "oauth" && (
        <>
          <FieldDescription>
            {t(
              credential?.authorization_status === "authorized"
                ? "resources.reauthorizeHint"
                : "resources.credentialOAuthHint"
            )}
          </FieldDescription>
          {request && (
            <p role="status" className="text-sm">
              <a
                className="underline"
                href={request.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("resources.continueAuthorization")}
              </a>{" "}
              · {t("resources.waitAuthorization")}
            </p>
          )}
        </>
      )}
      {(method === "oauth" || credential) && (
        <div className="flex flex-wrap gap-2">
          {method === "oauth" && (
            <Button
              type="button"
              onClick={authorize}
              loading={operation === "authorize" || !!request}
              disabled={pending || !!request || !name.trim()}
            >
              {t(
                credential?.authorization_status === "authorized"
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
                loading={operation === "test"}
                onClick={() =>
                  void run(async () => {
                    validate()
                    const target = await onPrepare()
                    if (!target) return
                    const current = currentCredential(target)
                    if (!current) return
                    try {
                      await api(
                        base +
                          `/connectors/${target.id}/credentials/${current.id}/test`,
                        { method: "POST" }
                      )
                      showToast({
                        status: "success",
                        title: t("resources.credentialTestPassed"),
                      })
                    } finally {
                      const updated = await onChange(target.id)
                      acceptCredential(updated.credentials[0] ?? null)
                    }
                  }, "test")
                }
              >
                {t("pages.tools.testConnection")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || !!request}
                loading={operation === "revoke"}
                onClick={() =>
                  void run(async () => {
                    const updated = await onRevoke({
                      id: credential.id,
                      revision: credential.revision,
                      revoke: true,
                    })
                    if (!updated) return
                    accept(updated, { revoke: true })
                    showToast({
                      status: "success",
                      title: t("resources.operationCompleted"),
                    })
                  }, "revoke")
                }
              >
                {t("resources.revokeCredential")}
              </Button>
            </>
          )}
        </div>
      )}
    </fieldset>
  )
}
