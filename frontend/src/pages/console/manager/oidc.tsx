import React from 'react'
import { Copy, Save, ShieldCheck, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { apiRequest } from '@/utils/requestUtils'

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

const defaultForm: OIDCForm = {
  enabled: false,
  display_name: '企业登录',
  issuer: '',
  client_id: '',
  client_secret: '',
  scopes: 'openid email profile',
  email_domain: '',
  auto_create_member: false,
  allow_password_login: true,
}

export default function TeamManagerOIDC() {
  const [form, setForm] = React.useState<OIDCForm>(defaultForm)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  const load = React.useCallback(async () => {
    await apiRequest('v1TeamsOidcList', {}, [], (resp) => {
      const cfg = resp.data?.config
      if (cfg) setForm({ ...defaultForm, ...cfg, client_secret: '' })
    })
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const update = <K extends keyof OIDCForm>(key: K, value: OIDCForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const copy = async (value?: string) => {
    if (!value) return
    await navigator.clipboard.writeText(value)
    toast.success('已复制')
  }

  const save = async () => {
    setSaving(true)
    await apiRequest('v1TeamsOidcUpdate', form, [], (resp) => {
      if (resp.code === 0) {
        toast.success('企业登录配置已保存')
        const cfg = resp.data?.config
        if (cfg) setForm({ ...defaultForm, ...cfg, client_secret: '' })
      } else {
        toast.error(resp.message || '保存失败')
      }
    })
    setSaving(false)
  }

  const test = async () => {
    setTesting(true)
    await apiRequest('v1TeamsOidcTestCreate', form, [], (resp) => {
      if (resp.code === 0) toast.success('连接测试通过')
      else toast.error(resp.message || '连接测试失败')
    })
    setTesting(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">企业登录</h1>
        <p className="text-sm text-muted-foreground">配置团队成员使用企业 OIDC 身份源登录。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck size={18} />
            OIDC 配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>启用企业登录</FieldLabel>
                <Switch checked={form.enabled} onCheckedChange={(value) => update('enabled', value)} />
              </Field>
              <Field>
                <FieldLabel>允许自动创建成员</FieldLabel>
                <Switch checked={form.auto_create_member} onCheckedChange={(value) => update('auto_create_member', value)} />
              </Field>
              <Field>
                <FieldLabel>允许账号密码登录</FieldLabel>
                <Switch checked={form.allow_password_login} onCheckedChange={(value) => update('allow_password_login', value)} />
              </Field>
              <Field>
                <FieldLabel>登录按钮名称</FieldLabel>
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
              <FieldLabel>Client Secret{form.has_client_secret ? '（已配置）' : ''}</FieldLabel>
              <Input
                type="password"
                value={form.client_secret}
                onChange={(event) => update('client_secret', event.target.value)}
                placeholder={form.has_client_secret ? '留空表示不修改' : ''}
              />
            </Field>
            <Field>
              <FieldLabel>Scopes</FieldLabel>
              <Input value={form.scopes} onChange={(event) => update('scopes', event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>邮箱域名限制</FieldLabel>
              <Input value={form.email_domain} placeholder="example.com" onChange={(event) => update('email_domain', event.target.value)} />
            </Field>
          </FieldGroup>

          <div className="mt-6 grid gap-3">
            <ReadonlyCopy label="Redirect URI" value={form.redirect_uri} onCopy={copy} />
            <ReadonlyCopy label="团队登录链接" value={form.login_url} onCopy={copy} />
          </div>

          <div className="mt-6 flex gap-3">
            <Button onClick={save} disabled={saving}>
              <Save size={16} />
              {saving ? '保存中...' : '保存'}
            </Button>
            <Button variant="outline" onClick={test} disabled={testing}>
              <TestTube2 size={16} />
              {testing ? '测试中...' : '测试连接'}
            </Button>
          </div>
        </CardContent>
      </Card>
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
