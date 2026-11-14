import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"

export function ResourceInput({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
  step?: number
}) {
  const numeric = Number(value)
  // 滑块覆盖常用范围，数字输入保留完整配额范围。
  const rangeMax = Math.min(
    max,
    Math.max(
      min + step,
      numeric || min,
      id.endsWith("cpu") || id.endsWith("CPU")
        ? 16
        : id.endsWith("memory") || id.endsWith("Memory")
          ? 64
          : 20
    )
  )
  return (
    <Field>
      <FieldLabel id={`${id}-label`} htmlFor={id}>
        {label}
      </FieldLabel>
      <div className="flex items-center gap-5">
        <Input
          type="range"
          aria-labelledby={`${id}-label`}
          min={min}
          max={rangeMax}
          step={step}
          value={
            Number.isFinite(numeric)
              ? Math.min(rangeMax, Math.max(min, numeric))
              : min
          }
          onChange={(event) => onChange(event.target.value)}
          className="h-8 min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 accent-primary shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent"
        />
        <Input
          id={id}
          aria-labelledby={`${id}-label`}
          type="number"
          required
          min={min}
          max={max}
          step={step === 1 ? 1 : "any"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 shrink-0 text-center tabular-nums"
        />
      </div>
    </Field>
  )
}
