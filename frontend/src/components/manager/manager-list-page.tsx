import type { ReactNode } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

export function ManagerListCard({
  title,
  description,
  icon,
  count,
  children,
  pagination,
}: {
  title: string
  description: string
  icon: ReactNode
  count?: number
  children: ReactNode
  pagination: ReactNode
}) {
  return (
    <Card className="min-h-0 flex-1 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>
          {description}
          {typeof count === "number" && ` · 当前 ${count} 条`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-0 pb-0">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {pagination}
      </CardContent>
    </Card>
  )
}

export function ManagerListLoading({ title }: { title: string }) {
  return (
    <Card className="min-h-0 flex-1 shadow-none">
      <CardContent className="flex min-h-0 flex-1">
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner className="size-6" />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </CardContent>
    </Card>
  )
}

export function ManagerListEmpty({
  title,
  description,
  colSpan,
}: {
  title: string
  description: string
  colSpan: number
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <Empty className="border-0 py-16">
          <EmptyHeader>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </td>
    </tr>
  )
}
