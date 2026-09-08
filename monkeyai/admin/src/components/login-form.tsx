import { LockKeyIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Trans, useTranslation } from "react-i18next"

import { EcosystemRadar } from "@/components/ecosystem-radar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldSeparator,
} from "@/components/ui/field"
import { EmailAuthForm } from "@/components/email-auth-form"
import type { AuthUser } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

export type LoginProvider = {
  id: string
  provider: string
  name: string
}

type LoginFormProps = React.ComponentProps<"div"> & {
  error: string
  oauthSubmitting: string
  providers: LoginProvider[]
  onAuthenticated: (user: AuthUser) => Promise<void>
  onOAuthLogin: (provider: LoginProvider) => void
}

export function LoginForm({
  error,
  oauthSubmitting,
  providers,
  onAuthenticated,
  onOAuthLogin,
  className,
  ...props
}: LoginFormProps) {
  const { t } = useTranslation()

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <div className="p-6 md:p-8">
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">{t("login.title")}</h1>
                <p className="text-balance text-muted-foreground">
                  {t("login.subtitle")}
                </p>
              </div>
              <EmailAuthForm
                admin
                disabled={Boolean(oauthSubmitting)}
                hasProviders={providers.length > 0}
                onAuthenticated={onAuthenticated}
              />
              {error && (
                <p
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
              {providers.length > 0 && (
                <>
                  <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                    {t("login.continueWith")}
                  </FieldSeparator>
                  <Field className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {providers.map((provider) => (
                      <Button
                        key={provider.id}
                        variant="outline"
                        type="button"
                        className="min-h-11 min-w-0 justify-start"
                        disabled={Boolean(oauthSubmitting)}
                        aria-busy={oauthSubmitting === provider.id}
                        aria-label={t("login.loginWith", {
                          provider: provider.name,
                        })}
                        title={provider.name}
                        onClick={() => onOAuthLogin(provider)}
                      >
                        <HugeiconsIcon
                          aria-hidden="true"
                          icon={LockKeyIcon}
                          strokeWidth={2}
                        />
                        <span className="truncate">
                          {oauthSubmitting === provider.id
                            ? `${provider.name}…`
                            : provider.name}
                        </span>
                      </Button>
                    ))}
                  </Field>
                </>
              )}
              <FieldDescription className="mt-4 px-2 text-center">
                <Trans
                  i18nKey="login.legal"
                  components={{
                    terms: <a href="#" />,
                    privacy: <a href="#" />,
                  }}
                />
              </FieldDescription>
            </FieldGroup>
          </div>
          <div className="relative hidden bg-muted md:block">
            <EcosystemRadar />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
