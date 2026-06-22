import React from 'react'
import { Copy, Save, ShieldCheck, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiRequest } from '@/utils/requestUtils'
import { useTranslation } from 'react-i18next'

type OIDCForm = {
  enabled: boolean
  display_name: string
  issuer: string
  client_id: string
  client_secret: string
  scopes: string
  email_domain: string
  auto_create_member: boolean
  allow_password_login: boolean
  redirect_uri?: string
  login_url?: string
  has_client_secret?: boolean
}

const baseDefaultForm: OIDCForm = {
  enabled: false,
  display_name: '',
  issuer: '',
  client_id: '',
  client_secret: '',
  scopes: 'openid email profile',
  email_domain: '',
  auto_create_member: false,
  allow_password_login: true,
}

export default function TeamManagerOIDC() {
  const { t } = useTranslation()
  const defaultForm = React.useMemo<OIDCForm>(() => ({
    ...baseDefaultForm,
    display_name: t("managerOidc.title"),
  }), [t])
  const [form, setForm] = React.useState<OIDCForm>(defaultForm)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  const load = React.useCallback(async () => {
    await apiRequest('v1TeamsOidcList', {}, [], (resp) => {
      const cfg = resp.data?.config
      if (cfg) setForm({ ...defaultForm, ...cfg, client_secret: '' })
    })
  }, [defaultForm])

  React.useEffect(() => {
    load()
  }, [load])

  const update = <K extends keyof OIDCForm>(key: K, value: OIDCForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const copy = async (value?: string) => {
    if (!value) return
    await navigator.clipboard.writeText(value)
    toast.success(t("managerOidc.toast.copied"))
  }

  const save = async () => {
    setSaving(true)
    await apiRequest('v1TeamsOidcUpdate', form, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerOidc.toast.saved"))
        const cfg = resp.data?.config
        if (cfg) setForm({ ...defaultForm, ...cfg, client_secret: '' })
      } else {
        toast.error(resp.message || t("managerOidc.toast.saveFailed"))
      }
    })
    setSaving(false)
  }

  const test = async () => {
    setTesting(true)
    await apiRequest('v1TeamsOidcTestCreate', form, [], (resp) => {
      if (resp.code === 0) toast.success(t("managerOidc.toast.testPassed"))
      else toast.error(resp.message || t("managerOidc.toast.testFailed"))
    })
    setTesting(false)
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck size={18} />
            {t("managerOidc.title")}
          </CardTitle>
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            {t("managerOidc.actions.configure")}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SummaryItem label={t("managerOidc.summary.enabled")} value={form.enabled ? t("managerOidc.values.enabled") : t("managerOidc.values.disabled")} />
            <SummaryItem label={t("managerOidc.summary.displayName")} value={form.display_name || t("managerOidc.values.notConfigured")} />
            <SummaryItem label="Issuer" value={form.issuer || t("managerOidc.values.notConfigured")} />
            <SummaryItem label={t("managerOidc.summary.emailDomain")} value={form.email_domain || t("managerOidc.values.unrestricted")} />
            <SummaryItem label={t("managerOidc.summary.autoCreateMember")} value={form.auto_create_member ? t("managerOidc.values.allowed") : t("managerOidc.values.notAllowed")} />
            <SummaryItem label={t("managerOidc.summary.passwordLogin")} value={form.allow_password_login ? t("managerOidc.values.allowed") : t("managerOidc.values.notAllowed")} />
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("managerOidc.dialog.title")}</DialogTitle>
            <DialogDescription>{t("managerOidc.dialog.description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>{t("managerOidc.fields.enabled")}</FieldLabel>
                <Switch checked={form.enabled} onCheckedChange={(value) => update('enabled', value)} />
              </Field>
              <Field>
                <FieldLabel>{t("managerOidc.fields.autoCreateMember")}</FieldLabel>
                <Switch checked={form.auto_create_member} onCheckedChange={(value) => update('auto_create_member', value)} />
              </Field>
              <Field>
                <FieldLabel>{t("managerOidc.fields.passwordLogin")}</FieldLabel>
                <Switch checked={form.allow_password_login} onCheckedChange={(value) => update('allow_password_login', value)} />
              </Field>
              <Field>
                <FieldLabel>{t("managerOidc.fields.displayName")}</FieldLabel>
                <Input value={form.display_name} onChange={(event) => update('display_name', event.target.value)} />
              </Field>
            </div>

            <Field>
              <FieldLabel>Issuer</FieldLabel>
              <Input value={form.issuer} placeholder="https://id.example.com" onChange={(event) => update('issuer', event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Client ID</FieldLabel>
              <Input value={form.client_id} onChange={(event) => update('client_id', event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>
                {t("managerOidc.fields.clientSecret")}
                {form.has_client_secret ? t("managerOidc.values.configuredSuffix") : ''}
              </FieldLabel>
              <Input
                type="password"
                value={form.client_secret}
                onChange={(event) => update('client_secret', event.target.value)}
                placeholder={form.has_client_secret ? t("managerOidc.placeholders.keepSecret") : ''}
              />
            </Field>
            <Field>
              <FieldLabel>Scopes</FieldLabel>
              <Input value={form.scopes} onChange={(event) => update('scopes', event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t("managerOidc.fields.emailDomain")}</FieldLabel>
              <Input value={form.email_domain} placeholder="example.com" onChange={(event) => update('email_domain', event.target.value)} />
            </Field>
          </FieldGroup>

          <div className="mt-6 grid gap-3">
            <ReadonlyCopy label="Redirect URI" value={form.redirect_uri} onCopy={copy} />
            <ReadonlyCopy label={t("managerOidc.fields.teamLoginUrl")} value={form.login_url} onCopy={copy} />
          </div>

          <div className="mt-6 flex gap-3">
            <Button onClick={save} disabled={saving}>
              <Save size={16} />
              {saving ? t("managerOidc.actions.saving") : t("managerOidc.actions.save")}
            </Button>
            <Button variant="outline" onClick={test} disabled={testing}>
              <TestTube2 size={16} />
              {testing ? t("managerOidc.actions.testing") : t("managerOidc.actions.test")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={value}>
        {value}
      </div>
    </div>
  )
}

function ReadonlyCopy({ label, value, onCopy }: { label: string; value?: string; onCopy: (value?: string) => void }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input value={value || ''} readOnly />
        <Button type="button" variant="outline" size="icon" onClick={() => onCopy(value)}>
          <Copy size={16} />
        </Button>
      </div>
    </Field>
  )
}
