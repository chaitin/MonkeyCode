import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

function AspectRatioGlyph({ value }: { value: string }) {
  const [rawWidth, rawHeight] = value.split(":").map(Number)
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1
  const scale = Math.min(36 / width, 24 / height)

  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-9 items-center justify-center"
    >
      <span
        className="rounded-[3px] border-[1.5px] border-current/60 bg-current/5"
        style={{
          width: Math.max(6, Math.round(width * scale)),
          height: Math.max(6, Math.round(height * scale)),
        }}
      />
    </span>
  )
}

function SelectionHeader({
  label,
  selected,
  total,
  selectAllLabel,
  onSelectAll,
}: {
  label: string
  selected: number
  total: number
  selectAllLabel: string
  onSelectAll: () => void
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <FieldLabel>{label}</FieldLabel>
        <Badge className="tabular-nums" variant="secondary">
          {selected}/{total}
        </Badge>
      </div>
      <Button
        aria-label={`${label}: ${selectAllLabel}`}
        className="h-7 px-2 text-xs"
        disabled={selected === total}
        onClick={onSelectAll}
        size="sm"
        type="button"
        variant="ghost"
      >
        {selectAllLabel}
      </Button>
    </div>
  )
}

function SelectedMark() {
  return (
    <span className="absolute end-2 top-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 transition-opacity group-aria-pressed:opacity-100">
      <HugeiconsIcon aria-hidden="true" icon={Tick02Icon} size={11} />
    </span>
  )
}

type ImageCapabilitySelectorProps = {
  qualities: string[]
  aspectRatios: string[]
  selectedQualities: string[]
  selectedAspectRatios: string[]
  qualityMultipliers: Record<string, string>
  qualityLabel: string
  aspectRatioLabel: string
  selectAllLabel: string
  onQualitiesChange: (values: string[]) => void
  onAspectRatiosChange: (values: string[]) => void
}

export function ImageCapabilitySelector({
  qualities,
  aspectRatios,
  selectedQualities,
  selectedAspectRatios,
  qualityMultipliers,
  qualityLabel,
  aspectRatioLabel,
  selectAllLabel,
  onQualitiesChange,
  onAspectRatiosChange,
}: ImageCapabilitySelectorProps) {
  return (
    <>
      <Field>
        <SelectionHeader
          label={qualityLabel}
          selected={selectedQualities.length}
          total={qualities.length}
          selectAllLabel={selectAllLabel}
          onSelectAll={() => onQualitiesChange([...qualities])}
        />
        <ToggleGroup
          aria-label={qualityLabel}
          className="grid w-full grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2"
          multiple
          onValueChange={onQualitiesChange}
          value={selectedQualities}
        >
          {qualities.map((value) => (
            <ToggleGroupItem
              key={value}
              aria-label={value}
              className="group relative h-16 w-full min-w-0 flex-col items-start gap-1 rounded-lg border border-border bg-background px-3 py-2.5 text-start shadow-xs transition-[border-color,background-color,box-shadow,transform] hover:border-foreground/25 hover:bg-muted/40 active:scale-[0.98] aria-pressed:border-primary/60 aria-pressed:bg-primary/6 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-primary/15"
              value={value}
            >
              <span className="text-sm font-semibold tracking-tight">
                {value}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                ×{qualityMultipliers[value] ?? "1"}
              </span>
              <SelectedMark />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field>
        <SelectionHeader
          label={aspectRatioLabel}
          selected={selectedAspectRatios.length}
          total={aspectRatios.length}
          selectAllLabel={selectAllLabel}
          onSelectAll={() => onAspectRatiosChange([...aspectRatios])}
        />
        <ToggleGroup
          aria-label={aspectRatioLabel}
          className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
          multiple
          onValueChange={onAspectRatiosChange}
          value={selectedAspectRatios}
        >
          {aspectRatios.map((value) => (
            <ToggleGroupItem
              key={value}
              aria-label={value}
              className="group relative h-[4.5rem] w-full min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-center shadow-xs transition-[border-color,background-color,box-shadow,transform] hover:border-foreground/25 hover:bg-muted/40 active:scale-[0.98] aria-pressed:border-primary/60 aria-pressed:bg-primary/6 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-primary/15"
              value={value}
            >
              <AspectRatioGlyph value={value} />
              <span className="text-xs font-medium tabular-nums" dir="ltr">
                {value}
              </span>
              <SelectedMark />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
    </>
  )
}
