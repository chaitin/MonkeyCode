import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"
import { base, match, type Credential } from "@/lib/resources"
import { Button } from "@/components/ui/button"
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
  getValue: (connectorName: string) => ConnectorCredentialInput | undefined
  accept: (
    connector: CredentialConnector,
    written?: ConnectorCredentialInput
  ) => void
}

function credentialHeaders(credential: Credential | null) {
  return (credential?.header_names ?? []).map((key) => ({ key, value: "" }))
}

function credentialNameFor(connectorName: string) {
  return Array.from(connectorName.trim()).slice(0, 128).join("")
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
  actionContainer,
}: {
  ref: Ref<ConnectorCredentialsHandle>
  connector: CredentialConnector | null
  method: "oauth" | "httpHeader"
  active: boolean
  disabled: boolean
  onPrepare: () => Promise<CredentialConnector | null>
  onChange: (id: string, refreshList?: boolean) => Promise<CredentialConnector>
  onRevoke: (
    change: ConnectorCredentialInput
  ) => Promise<CredentialConnector | null>
  onBusyChange: (busy: boolean) => void
  actionContainer: HTMLElement | null
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
  const [headers, setHeaders] = useState(() =>
    connector
      ? credentialHeaders(credential)
      : [{ key: "Authorization", value: "" }]
  )
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
  const storedHeaderNames = new Set(
    credentialMethod === "httpHeader"
      ? credential?.header_names.map((key) => key.toLowerCase())
      : []
  )
  const headersChanged =
    !credential ||
    credentialMethod !== "httpHeader" ||
    headers.length !== storedHeaderNames.size ||
    headers.some(
      (header) =>
        header.value !== "" ||
        !storedHeaderNames.has(header.key.trim().toLowerCase())
    )

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
    if (method === "httpHeader") {
      const seen = new Set<string>()
      for (const header of headers) {
        const key = header.key.trim().toLowerCase()
        if (!key || seen.has(key))
          throw new Error(t("resources.headerDuplicate"))
        seen.add(key)
        if (header.value === "" && !storedHeaderNames.has(key))
          throw new Error(t("resources.headerValueRequired"))
      }
    }
  }

  const getValue = (
    connectorName: string
  ): ConnectorCredentialInput | undefined => {
    validate()
    const data: ConnectorCredentialInput = {}
    if (credential) {
      data.id = credential.id
      data.revision = credential.revision
    } else {
      data.name = credentialNameFor(connectorName)
    }
    if (method === "httpHeader" && headersChanged) {
      data.http_headers = Object.fromEntries(
        headers.map((header) => [header.key.trim(), header.value])
      )
    }
    if (credential && !data.http_headers) return undefined
    return data
  }

  const accept = (
    target: CredentialConnector,
    written?: ConnectorCredentialInput
  ) => {
    const saved = target.credentials[0] ?? null
    acceptCredential(saved)
    if (saved) setCredentialMethod(target.authorizationMethod)
    if (written?.http_headers || written?.revoke) {
      setHeaders(credentialHeaders(saved))
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
    if (lock.current) return
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
              : {
                  body: JSON.stringify({
                    name: credentialNameFor(target.name),
                  }),
                }),
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
      className={active ? "flex min-w-0 flex-col gap-4" : "hidden"}
    >
      {active &&
        (method === "oauth" || credential) &&
        actionContainer &&
        createPortal(
          <>
            {method === "oauth" && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={authorize}
                loading={operation === "authorize" || !!request}
                disabled={disabled || pending || !!request}
              >
                {t(
                  credential?.authorization_status === "authorized"
                    ? "pages.tools.reauthorize"
                    : "pages.tools.connectAndAuthorize"
                )}
              </Button>
            )}
            {method === "oauth" && credential && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled || pending || !!request}
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
            )}
            {credential && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={
                  disabled ||
                  pending ||
                  !!request ||
                  (method === "httpHeader" && headersChanged)
                }
                loading={operation === "test"}
                onClick={() =>
                  void run(async () => {
                    validate()
                    const target = connector
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
                      const updated = await onChange(target.id, false)
                      acceptCredential(updated.credentials[0] ?? null)
                    }
                  }, "test")
                }
              >
                {t("pages.tools.testConnection")}
              </Button>
            )}
          </>,
          actionContainer
        )}
      {credential?.last_error && (
        <p className="text-sm text-destructive" role="status">
          {credential.last_error}
        </p>
      )}
      {method === "httpHeader" && (
        <Field className="min-w-0 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>{t("pages.tools.httpHeaders")}</FieldLabel>
            <Button
              className="shrink-0"
              type="button"
              variant="outline"
              size="xs"
              disabled={headers.length >= 30}
              onClick={() => setHeaders([...headers, { key: "", value: "" }])}
            >
              {t("resources.addHeader")}
            </Button>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            {headers.map((header, index) => (
              <div className="flex min-w-0 flex-wrap gap-2" key={index}>
                <Input
                  aria-label={t("resources.headerName", {
                    index: index + 1,
                  })}
                  className="min-w-24 flex-1"
                  required
                  placeholder="Key"
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
                  required={
                    !storedHeaderNames.has(header.key.trim().toLowerCase())
                  }
                  placeholder={
                    storedHeaderNames.has(header.key.trim().toLowerCase())
                      ? t("resources.headerKeepValue")
                      : "Value"
                  }
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
                  onClick={() =>
                    setHeaders(headers.filter((_, i) => i !== index))
                  }
                >
                  {t("pages.tools.delete")}
                </Button>
              </div>
            ))}
          </div>
        </Field>
      )}
      {method === "oauth" && (
        <>
          {credential?.authorization_status !== "authorized" && (
            <FieldDescription>
              {t("resources.credentialOAuthHint")}
            </FieldDescription>
          )}
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
    </fieldset>
  )
}
