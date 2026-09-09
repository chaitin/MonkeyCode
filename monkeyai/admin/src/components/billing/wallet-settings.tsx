import { useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { dateTime, type WalletInfo } from "@/lib/billing"

const certificates = [
  {
    key: "certificate",
    label: "客户端证书",
    accept: ".crt,.pem",
    hint: "app.crt，PEM 格式",
  },
  {
    key: "private_key",
    label: "客户端私钥",
    accept: ".key,.pem",
    hint: "app.key，PKCS#8 格式的 ECDSA 私钥",
  },
  {
    key: "ca_certificate",
    label: "CA 证书",
    accept: ".crt,.pem",
    hint: "ca.crt，用于校验百智云服务端证书",
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
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-4 rounded-md border p-4 text-sm"
      aria-label="百智云连接配置"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">百智云连接配置</h3>
        <Badge variant="secondary">
          {info.configured ? "证书已配置" : "待配置"}
        </Badge>
      </div>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="billing-wallet-url">
              服务 URL（Base URL）
            </FieldLabel>
            <Input
              id="billing-wallet-url"
              type="url"
              autoComplete="off"
              spellCheck={false}
              required
              placeholder="https://baizhi.cloud"
              value={baseURL}
              aria-invalid={!!baseURL && !validWalletURL(baseURL)}
              aria-describedby="billing-wallet-url-hint"
              onChange={(event) => setBaseURL(event.target.value)}
            />
            <FieldDescription id="billing-wallet-url-hint">
              {baseURL && !validWalletURL(baseURL)
                ? "请输入 HTTPS 服务根地址，可包含端口，不含路径、参数或用户名密码。"
                : "填写百智云服务地址，私有化部署填写统一网关地址。"}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="billing-wallet-app">
              应用 ID（App ID）
            </FieldLabel>
            <Input
              id="billing-wallet-app"
              inputMode="numeric"
              autoComplete="off"
              required
              value={appID}
              aria-invalid={!!appID && !validID}
              aria-describedby="billing-wallet-app-hint"
              onChange={(event) => setAppID(event.target.value)}
            />
            <FieldDescription id="billing-wallet-app-hint">
              {appID && !validID
                ? "请输入 1 到 999 之间的整数"
                : "填写该百智云服务对应的应用 ID"}
            </FieldDescription>
          </Field>
        </div>
        {certificates.map(({ key, label, accept, hint }) => (
          <Field key={key}>
            <FieldLabel htmlFor={`billing-wallet-${key}`}>{label}</FieldLabel>
            <Input
              id={`billing-wallet-${key}`}
              type="file"
              accept={accept}
              required={!info.credentials_configured}
              aria-describedby={`billing-wallet-${key}-hint`}
              onChange={(event) => {
                setFiles((previous) => ({
                  ...previous,
                  [key]: event.target.files?.[0],
                }))
                setError("")
              }}
            />
            <FieldDescription id={`billing-wallet-${key}-hint`}>
              {hint}，最大 64 KiB。
              {info.credentials_configured
                ? "已保存，不上传则保留原文件。"
                : "首次配置需要上传。"}
            </FieldDescription>
          </Field>
        ))}
        <p className="text-xs text-muted-foreground">
          保存时校验证书格式、有效期及私钥匹配关系，证书和私钥内容不回显。存在未完成交易时不能切换服务
          URL 或应用 ID，同一应用可更新证书。
        </p>
        <Button type="submit" variant="outline" disabled={!complete || !dirty}>
          {saving ? "保存中…" : "保存连接配置"}
        </Button>
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
