import { useId, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { TablePagination } from "@/components/table-pagination"
import { TableLoading } from "@/components/table-loading"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Card, CardContent } from "@/components/ui/card"

export function EnvironmentFrame({
  title,
  description,
  action,
  table = false,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  table?: boolean
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100vh-5rem)] md:flex-none md:overflow-hidden"
    >
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-[var(--card-spacing)]">
            <p className="min-w-0 text-sm text-muted-foreground">
              {description}
            </p>
            {action}
          </div>
          {table ? (
            children
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-[var(--card-spacing)]">
              {children}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

export function EnvironmentTable({
  title,
  columns,
  loading,
  error,
  empty,
  refresh,
  children,
}: {
  title: string
  columns: string[]
  loading: boolean
  error?: string
  empty: boolean
  refresh: () => void
  children: ReactNode
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:h-full">
      <Table
        aria-label={title}
        aria-busy={loading}
        className={empty ? "h-full" : undefined}
      >
        <TableHeader className="sticky top-0 z-10">
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column}
                className="first:ps-[var(--card-spacing)] last:pe-[var(--card-spacing)]"
              >
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={empty ? "h-full" : undefined}>
          {empty ? (
            <TableRow className="h-full">
              <TableCell
                colSpan={columns.length}
                className="h-full py-12 text-center text-muted-foreground"
              >
                <LoadState
                  loading={loading}
                  error={error}
                  empty
                  refresh={refresh}
                />
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
    </div>
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
  if (loading) return <TableLoading />
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
  total,
  page,
  count,
  disabled,
  onChange,
}: {
  total?: number
  page: number
  count: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <TablePagination
      page={page}
      pageSize={20}
      itemCount={count}
      total={total}
      loading={disabled}
      hasNext={total === undefined ? count >= 20 : page * 20 < total}
      onPrevious={() => onChange(page - 1)}
      onNext={() => onChange(page + 1)}
    />
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
