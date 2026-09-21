import { Loading03Icon, LockKeyIcon } from "@hugeicons/core-free-icons"
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { LoginMarquees } from "@/components/login-marquees"
import { ShaderBackground } from "@/components/motion/shader-background"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup } from "@/components/ui/field"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { EmailAuthForm } from "@/components/email-auth-form"
import type { AuthUser } from "@/lib/auth-context"
import { cn } from "@/lib/utils"

export type LoginProvider = {
  id: string
  provider: string
  name: string
}

type LoginFormProps = React.ComponentProps<"div"> & {
  oauthSubmitting: string
  providers: LoginProvider[]
  teamName: string
  toolName: string
  onAuthenticated: (user: AuthUser) => Promise<void>
  onOAuthLogin: (provider: LoginProvider) => void
}

export function LoginForm({
  oauthSubmitting,
  providers,
  teamName,
  toolName,
  onAuthenticated,
  onOAuthLogin,
  className,
  ...props
}: LoginFormProps) {
  const { t } = useTranslation()
  const [hasEmailLogin, setHasEmailLogin] = useState(false)

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <div className="p-6 md:flex md:items-center md:p-8">
            <FieldGroup className="w-full">
              <div className="flex flex-col items-center gap-2 text-center">
                <img
                  src="/monkeyai-logo.webp"
                  alt=""
                  className="mb-1 size-16 rounded-2xl object-cover shadow-sm"
                />
                <h1 className="text-2xl font-bold">{toolName}</h1>
                <p className="text-balance text-muted-foreground">
                  {t("login.adminPanelSubtitle", { teamName })}
                </p>
              </div>
              <EmailAuthForm
                admin
                disabled={Boolean(oauthSubmitting)}
                hasProviders={providers.length > 0}
                onAuthenticated={onAuthenticated}
                onLoginMethodsChange={setHasEmailLogin}
              />
              {providers.length > 0 && (
                <>
                  {hasEmailLogin && (
                    <Marker variant="separator">
                      <MarkerContent>
                        {t("login.otherLoginMethods")}
                      </MarkerContent>
                    </Marker>
                  )}
                  <Field className="flex flex-col gap-3">
                    {providers.map((provider) => (
                      <Button
                        key={provider.id}
                        variant="outline"
                        size="lg"
                        type="button"
                        className="w-full min-w-0"
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
                          icon={
                            oauthSubmitting === provider.id
                              ? Loading03Icon
                              : LockKeyIcon
                          }
                          className={
                            oauthSubmitting === provider.id
                              ? "animate-spin motion-reduce:animate-none"
                              : undefined
                          }
                          strokeWidth={2}
                        />
                        <span className="truncate">{provider.name}</span>
                      </Button>
                    ))}
                  </Field>
                </>
              )}
            </FieldGroup>
          </div>
          <div className="relative hidden min-h-[36rem] overflow-hidden bg-neutral-950 md:block">
            <ShaderBackground
              variant="mesh-gradient"
              className="absolute inset-0"
              colors={["#fafafa", "#a3a3a3", "#404040", "#0a0a0a"]}
              distortion={0.8}
              swirl={0.35}
              speed={0.35}
            />
            <LoginMarquees />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
