import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type DashboardRange = "today" | "7d" | "30d"

const labels: Record<DashboardRange, string> = {
  today: "今日",
  "7d": "近 7 天",
  "30d": "近 30 天",
}

export function TimeRangeTabs({
  value,
  onChange,
}: {
  value: DashboardRange
  onChange: (value: DashboardRange) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      className="justify-start"
      onValueChange={(next) => {
        if (next === "today" || next === "7d" || next === "30d") {
          onChange(next)
        }
      }}
    >
      {(Object.keys(labels) as DashboardRange[]).map((key) => (
        <ToggleGroupItem key={key} value={key} size="sm">
          {labels[key]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
