import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function MetricCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description?: string
}) {
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-normal">{value}</div>
        {description && (
          <p className="text-muted-foreground mt-2 text-sm">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}
