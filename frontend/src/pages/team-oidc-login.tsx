import React from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { apiRequest } from '@/utils/requestUtils'

type PublicConfig = {
  team_id?: string
  enabled?: boolean
  display_name?: string
  login_url?: string
}

export default function TeamOIDCLoginPage() {
  const { t } = useTranslation()
  const { teamId } = useParams()
  const [config, setConfig] = React.useState<PublicConfig | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!teamId) {
      setLoading(false)
      return
    }

    apiRequest('v1UsersOidcTeamsDetail', {}, [teamId], (resp) => {
      if (resp.code === 0) setConfig(resp.data)
      else toast.error(resp.message || t("auth.teamOidc.fetchFailed"))
      setLoading(false)
    }, () => {
      setLoading(false)
      toast.error(t("auth.teamOidc.fetchFailed"))
    })
  }, [teamId, t])

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Link to="/">
          <h1 className="mb-6 text-2xl hover:font-bold">{t("login.title")}</h1>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={20} />
              {t("auth.teamOidc.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                {t("auth.teamOidc.loading")}
              </div>
            ) : config?.enabled ? (
              <Button size="lg" className="w-full" asChild>
                <a href={config.login_url || `/api/v1/users/oidc/login?team_id=${teamId}`}>
                  {config.display_name || t("auth.teamOidc.title")}
                </a>
              </Button>
            ) : (
              <div className="text-sm text-muted-foreground">{t("auth.teamOidc.disabled")}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
