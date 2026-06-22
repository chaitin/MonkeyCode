import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "react-i18next"

export type DashboardRange = "today" | "7d" | "30d"

export function TimeRangeTabs({
  value,
  onChange,
}: {
  value: DashboardRange
  onChange: (value: DashboardRange) => void
}) {
  const { t } = useTranslation()
  const labels: Record<DashboardRange, string> = {
    today: t("managerOverview.ranges.today"),
    "7d": t("managerOverview.ranges.last7Days"),
    "30d": t("managerOverview.ranges.last30Days"),
  }

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
