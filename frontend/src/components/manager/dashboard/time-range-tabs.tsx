import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
    <Tabs
      value={value}
      onValueChange={(next: string) => {
        if (next === "today" || next === "7d" || next === "30d") {
          onChange(next)
        }
      }}
    >
      <TabsList>
        {(Object.keys(labels) as DashboardRange[]).map((key) => (
          <TabsTrigger key={key} value={key}>
            {labels[key]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
