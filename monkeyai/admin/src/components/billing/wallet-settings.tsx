import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError } from "@/lib/api"
import { dateTime, type WalletInfo } from "@/lib/billing"

const certificates = [
  {
    key: "certificate",
    label: "客户端证书",
    accept: ".crt,.pem",
  },
  {
    key: "private_key",
    label: "客户端私钥",
    accept: ".key,.pem",
  },
  {
    key: "ca_certificate",
    label: "CA 证书",
    accept: ".crt,.pem",
  },
] as const

export type WalletInput = {
  base_url: string
  app_id: number
  certificate: string
  private_key: string
  ca_certificate: string
}

export function WalletSettings({
  info,
  busy,
  onSave,
}: {
  info: WalletInfo
  busy: boolean
  onSave: (input: WalletInput) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [baseURL, setBaseURL] = useState(info.base_url ?? "")
  const [appID, setAppID] = useState(info.app_id?.toString() ?? "")
  const [files, setFiles] = useState<
    Partial<Record<(typeof certificates)[number]["key"], File>>
  >({})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const validID =
    /^\d+$/.test(appID) && Number(appID) >= 1 && Number(appID) <= 999
  const dirty =
    baseURL.trim() !== (info.base_url ?? "") ||
    appID !== (info.app_id?.toString() ?? "") ||
    Object.values(files).some(Boolean)
  const complete =
    validWalletURL(baseURL) &&
    validID &&
    (info.credentials_configured || certificates.every(({ key }) => files[key]))

  const certificateField = ({
    key,
    label,
    accept,
  }: (typeof certificates)[number]) => (
    <Field key={key}>
      <FieldLabel htmlFor={`billing-wallet-${key}`}>{label}</FieldLabel>
      <Input
        id={`billing-wallet-${key}`}
        type="file"
        accept={accept}
        required={!info.credentials_configured}
        onChange={(event) => {
          setFiles((previous) => ({
            ...previous,
            [key]: event.target.files?.[0],
          }))
          setError("")
        }}
      />
    </Field>
  )

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    if (!complete || saving || busy) return
    setSaving(true)
    setError("")
    try {
      const input: WalletInput = {
        base_url: baseURL.trim(),
        app_id: Number(appID),
        certificate: "",
        private_key: "",
        ca_certificate: "",
      }
      for (const { key, label } of certificates) {
        const file = files[key]
        if (!file) continue
        if (file.size === 0 || file.size > 64 * 1024) {
          throw new Error(`${label}不能为空或超过 64 KiB`)
        }
        input[key] = await file.text().catch(() => {
          throw new Error(`${label}读取失败，请重新选择文件`)
        })
        if (!input[key].trim()) throw new Error(`${label}不能为空`)
      }
      if (await onSave(input)) {
        form.reset()
        setFiles({})
      }
    } catch (e) {
      if (!(e instanceof ApiError)) setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-4 text-sm"
      aria-label="百智云连接配置"
    >
      {info.certificate_expires_at && (
        <p className="text-xs text-muted-foreground">
          客户端证书到期：{dateTime(info.certificate_expires_at)}
        </p>
      )}
      {info.source === "environment" && (
        <p className="text-xs text-muted-foreground">
          当前使用部署配置，保存后将优先使用此处的配置。
        </p>
      )}
      {info.error && (
        <p role="alert" className="text-destructive">
          {info.error}
        </p>
      )}
      <fieldset
        disabled={busy || saving}
        className="space-y-4 disabled:opacity-60"
      >
        <Field>
          <FieldLabel htmlFor="billing-wallet-url">Base URL</FieldLabel>
          <Input
            id="billing-wallet-url"
            type="url"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="https://baizhi.cloud"
            value={baseURL}
            aria-invalid={!!baseURL && !validWalletURL(baseURL)}
            aria-describedby={
              baseURL && !validWalletURL(baseURL)
                ? "billing-wallet-url-hint"
                : undefined
            }
            onChange={(event) => setBaseURL(event.target.value)}
          />
          {baseURL && !validWalletURL(baseURL) && (
            <FieldDescription id="billing-wallet-url-hint">
              请输入 HTTPS 服务根地址，可包含端口，不含路径、参数或用户名密码。
            </FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="billing-wallet-app">App ID</FieldLabel>
          <Input
            id="billing-wallet-app"
            inputMode="numeric"
            autoComplete="off"
            required
            value={appID}
            aria-invalid={!!appID && !validID}
            aria-describedby={
              appID && !validID ? "billing-wallet-app-hint" : undefined
            }
            onChange={(event) => setAppID(event.target.value)}
          />
          {appID && !validID && (
            <FieldDescription id="billing-wallet-app-hint">
              请输入 1 到 999 之间的整数
            </FieldDescription>
          )}
        </Field>
        {certificates.slice(2).map(certificateField)}
        {certificates.slice(0, 2).map(certificateField)}
        {(dirty || saving) && (
          <Button type="submit" variant="outline" disabled={!complete}>
            {saving ? "保存中…" : t("pages.billingSettings.save")}
          </Button>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function validWalletURL(value: string) {
  try {
    const url = new URL(value.trim())
    return (
      /^https:\/\/[^/?#@\\\s]+\/?$/i.test(value.trim()) &&
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      url.port !== "0"
    )
  } catch {
    return false
  }
}
