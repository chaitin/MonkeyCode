import { Link, useSearchParams } from "react-router-dom"
import type { MemberMessageDepth } from "@/lib/statistics"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { UserAvatar } from "@/components/user-avatar"
import { AiChat02Icon, Award01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { StatisticsTrendCard } from "@/components/statistics-trend-card"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type DepthProps = { data?: MemberMessageDepth; loading: boolean }

export function MemberUsageDepthChart({ data, loading }: DepthProps) {
  return (
    <StatisticsTrendCard
      icon={AiChat02Icon}
      title="使用程度分布"
      valueLabel="发送消息"
      periodLabel="近 7 天"
      points={
        data?.percentiles.length
          ? data.percentiles.map((count, rank) => ({ date: `P${rank}`, count }))
          : undefined
      }
      color="var(--color-orange-500)"
      barClassName="fill-orange-500"
      formatValue={(value) => `${value} 条`}
      loading={loading}
    />
  )
}

const rankingLimit = 15

export function MemberMessageRanking({
  data,
  loading,
  error,
}: DepthProps & { error?: string }) {
  const [params] = useSearchParams()
  const topMembers = data?.top_members ?? []
  return (
    <Card className="min-h-0 min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70">
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={Award01Icon}
          size={16}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <CardTitle className="flex-1 text-sm font-medium text-muted-foreground">
          深度使用 Top {rankingLimit}
        </CardTitle>
        <span className="text-xs text-muted-foreground">近 7 天</span>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 rounded-xl border border-border/60 bg-card p-4">
        {loading ? (
          <p>正在加载成员…</p>
        ) : error ? (
          <p role="alert">成员加载失败</p>
        ) : null}
        <ol
          aria-label="近 7 天成员消息数排名"
          tabIndex={0}
          className="max-h-80 overflow-y-auto lg:grid lg:h-0 lg:max-h-none lg:flex-1 lg:auto-rows-fr"
        >
          {topMembers.map(
            ({ id, name, email, avatar_url, messages: count }) => {
              const search = new URLSearchParams(params)
              search.set("user_id", id)
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 border-b border-border/50 py-1.5 text-sm last:border-0"
                >
                  <Link
                    to={{
                      pathname: CONSOLE_ROUTES.memberAnalysis,
                      search: search.toString(),
                      hash: "#member-details",
                    }}
                    preventScrollReset
                    onClick={(event) => {
                      if (!(
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      ))
                        document
                          .getElementById("member-details")
                          ?.scrollIntoView({ block: "start" })
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 hover:text-blue-600 focus-visible:text-blue-600 dark:hover:text-blue-400 dark:focus-visible:text-blue-400"
                  >
                    <UserAvatar src={avatar_url} />
                    <span className="truncate">{name || email}</span>
                  </Link>
                  <span className="tabular-nums">
                    <span className="text-muted-foreground">共 </span>
                    {count}
                    <span className="text-muted-foreground"> 条消息</span>
                  </span>
                </li>
              )
            }
          )}
          {!loading &&
            !error &&
            Array.from(
              { length: rankingLimit - topMembers.length },
              (_, index) => (
                <li
                  key={`placeholder-${index}`}
                  aria-hidden="true"
                  className="flex items-center gap-2 border-b border-border/50 py-1.5 text-xs text-muted-foreground last:border-0"
                >
                  <span className="size-6 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
                  <span className="text-sm">虚位以待</span>
                  <span className="ms-auto">—</span>
                </li>
              )
            )}
        </ol>
      </CardContent>
    </Card>
  )
}
