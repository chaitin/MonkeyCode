import { useEffect, useRef, useState } from "react"
import { ImageUploadIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { useBranding } from "@/hooks/use-branding"
import { cn } from "@/lib/utils"

export type BrandLogoDraft = { file: File; previewURL: string } | null

export function BrandLogoSettings({
  value,
  onValueChange,
  disabled,
  loading,
}: {
  value: BrandLogoDraft
  onValueChange: (value: BrandLogoDraft) => void
  disabled: boolean
  loading: boolean
}) {
  const { t } = useTranslation()
  const { branding } = useBranding()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const replacement = value
  const hasCustomLogo = !!replacement || !!branding.logo_url
  useEffect(
    () => () => {
      if (replacement) URL.revokeObjectURL(replacement.previewURL)
    },
    [replacement]
  )
  const selectFile = (file: File) => {
    setError("")
    if (file.size > 1024 * 1024) {
      setError(t("pages.otherSettings.brandInfo.logoInvalid"))
      return
    }
    onValueChange({ file, previewURL: URL.createObjectURL(file) })
  }
  return (
    <Field>
      <FieldLabel htmlFor="brand-logo-file">
        {t("pages.otherSettings.brandInfo.logo")}
      </FieldLabel>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          id="brand-logo-upload"
          type="button"
          variant="ghost"
          className="group relative size-20 cursor-pointer overflow-hidden rounded-xl border-border bg-muted p-2 hover:bg-muted dark:hover:bg-muted"
          disabled={disabled}
          aria-busy={loading}
          aria-label={t(
            hasCustomLogo
              ? "pages.otherSettings.brandInfo.replaceLogo"
              : "pages.otherSettings.brandInfo.uploadLogo"
          )}
          onClick={() => input.current?.click()}
        >
          {value === null ? (
            <BrandLogo
              alt={t("pages.otherSettings.brandInfo.logo")}
              className="size-full object-contain"
            />
          ) : (
            <img
              alt={t("pages.otherSettings.brandInfo.logo")}
              className="size-full object-contain"
              src={replacement?.previewURL || "/monkeyai-logo.webp"}
              onError={(event) => {
                if (!event.currentTarget.src.endsWith("/monkeyai-logo.webp"))
                  event.currentTarget.src = "/monkeyai-logo.webp"
              }}
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none",
              loading && "opacity-100"
            )}
          >
            <HugeiconsIcon
              icon={loading ? Loading03Icon : ImageUploadIcon}
              className={cn(
                "size-6",
                loading && "animate-spin motion-reduce:animate-none"
              )}
              strokeWidth={2}
            />
          </span>
        </Button>
      </div>
      <Input
        ref={input}
        className="sr-only"
        tabIndex={-1}
        id="brand-logo-file"
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) selectFile(file)
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Field>
  )
}
