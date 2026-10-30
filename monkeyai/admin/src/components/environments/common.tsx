import { useId, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"

export function EnvironmentFrame({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {action}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
export function LoadState({
  loading,
  error,
  empty,
  refresh,
}: {
  loading: boolean
  error?: string
  empty: boolean
  refresh: () => void
}) {
  const { t } = useTranslation()
  if (loading)
    return (
      <p role="status" className="py-8 text-center text-muted-foreground">
        {t("environmentAdmin.loading")}
      </p>
    )
  if (error)
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{error}</p>
        <Button variant="outline" onClick={refresh}>
          {t("environmentAdmin.retry")}
        </Button>
      </div>
    )
  if (empty)
    return (
      <p className="py-8 text-center text-muted-foreground">
        {t("environmentAdmin.empty")}
      </p>
    )
  return null
}
export function Pagination({
  page,
  count,
  disabled,
  onChange,
}: {
  page: number
  count: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t("environmentAdmin.pagination")}
      className="flex flex-wrap items-center justify-end gap-3"
    >
      <Button
        variant="outline"
        disabled={page <= 1 || disabled}
        onClick={() => onChange(page - 1)}
      >
        {t("environmentAdmin.previous")}
      </Button>
      <span className="text-sm">{t("environmentAdmin.page", { page })}</span>
      <Button
        variant="outline"
        disabled={count < 20 || disabled}
        onClick={() => onChange(page + 1)}
      >
        {t("environmentAdmin.next")}
      </Button>
    </nav>
  )
}
export function NumberField({
  label,
  name,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  hint,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number | "any"
  hint?: string
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
    </Field>
  )
}
export function FormError({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null
}
export function Identity({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all text-sm">{value}</dd>
    </div>
  )
}
