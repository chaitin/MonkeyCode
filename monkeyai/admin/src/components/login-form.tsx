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
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type LoginProvider = {
  id: string
  provider: string
  name: string
}

type LoginFormProps = React.ComponentProps<"div"> & {
  email: string
  password: string
  error: string
  submitting: boolean
  oauthSubmitting: string
  providers: LoginProvider[]
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onLogin: () => void
  onOAuthLogin: (provider: LoginProvider) => void
}

export function LoginForm({
  email,
  password,
  error,
  submitting,
  oauthSubmitting,
  providers,
  onEmailChange,
  onPasswordChange,
  onLogin,
  onOAuthLogin,
  className,
  ...props
}: LoginFormProps) {
  const { t } = useTranslation()

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form
            className="p-6 md:p-8"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              onLogin()
            }}
          >
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">{t("login.title")}</h1>
                <p className="text-balance text-muted-foreground">
                  {t("login.subtitle")}
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="admin-email">
                  {t("login.email")}
                </FieldLabel>
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="admin@example.com"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="admin-password">
                    {t("login.password")}
                  </FieldLabel>
                  <a
                    href="#"
                    className="ms-auto text-sm underline-offset-2 hover:underline"
                  >
                    {t("login.forgotPassword")}
                  </a>
                </div>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  required
                />
              </Field>
              {error && (
                <p
                  className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <Field>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={
                    submitting ||
                    Boolean(oauthSubmitting) ||
                    !email.trim() ||
                    !password
                  }
                  aria-busy={submitting}
                >
                  {submitting ? `${t("login.submit")}…` : t("login.submit")}
                </Button>
              </Field>
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
                        disabled={submitting || Boolean(oauthSubmitting)}
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
          </form>
          <div className="relative hidden bg-muted md:block">
            <EcosystemRadar />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
