import { useId, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  Activity01Icon,
  AiChat02Icon,
  Coins01Icon,
  DocumentValidationIcon,
  Loading03Icon,
  Task01Icon,
  User02Icon,
  UserAdd01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { MemberActivityHeatmap } from "@/components/member-activity-heatmap"
import { StatisticsTrendCard } from "@/components/statistics-trend-card"
import { StatisticsPeriodComparison } from "@/components/statistics-period-comparison"
import { UserSearch } from "@/components/user-search"
import { UserAvatar } from "@/components/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useStatistics } from "@/hooks/use-statistics"
import type { MemberAnalysis, MemberOverview } from "@/lib/statistics"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { TABLE_DATE_TIME_OPTIONS } from "@/lib/date-time"
import { credits } from "@/lib/billing"
import { cn } from "@/lib/utils"

const key = "pages.sessionReporting.memberAnalysis"
const detailMetricIcons = {
  tasks: Task01Icon,
  conversations: AiChat02Icon,
  credits: Coins01Icon,
}

function MemberPicker({
  userID,
  id,
  onSelect,
}: {
  userID: string | null
  id: string
  onSelect: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  return (
    <UserSearch
      id={id}
      userID={userID ?? ""}
      query={query}
      placeholder={t(`${key}.selectMember`)}
      searchPlaceholder={t(`${key}.searchMembers`)}
      searchInPopup
      selectionOnly
      excludeDeleted
      onChange={({ userID, query }) => {
        setQuery(query)
        onSelect(userID || null)
      }}
    />
  )
}

function OverviewMetric({
  title,
  value,
  note,
  icon,
  comparison,
  qualifier,
  loading,
  textClassName,
  to,
}: {
  title: string
  value: string
  note: string
  icon: IconSvgElement
  comparison?: { current?: number; previous?: number; periodLabel: string }
  qualifier?: string
  loading: boolean
  textClassName?: string
  to?: string
}) {
  const { t } = useTranslation()
  return (
    <Card
      className="min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
      role="group"
      aria-label={qualifier ? `${title} · ${qualifier}` : title}
    >
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={icon}
          className="shrink-0 text-muted-foreground"
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {qualifier && (
          <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
            {qualifier}
          </span>
        )}
      </CardHeader>
      <CardContent
        className={cn(
          "group/metric-body min-h-20 flex-1 flex-row items-center gap-3 rounded-xl border border-border/60 bg-card p-5",
          loading ? "justify-center" : "justify-between",
          to && "relative cursor-pointer"
        )}
        aria-busy={loading}
      >
        {loading ? (
          <span
            role="status"
            aria-label={t("statistics.loading")}
            className="inline-flex items-center justify-center text-muted-foreground"
          >
            <HugeiconsIcon
              icon={Loading03Icon}
              className="animate-spin motion-reduce:animate-none"
              size={20}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </span>
        ) : (
          <>
            <p
              className={cn(
                "min-w-0 break-words text-2xl font-medium tabular-nums tracking-tight",
                textClassName
              )}
              title={`${value} · ${note}`}
            >
              {to ? (
                <Link
                  to={to}
                  aria-label={title}
                  className="absolute inset-0 flex items-center rounded-xl p-5 outline-none transition-colors focus-visible:text-teal-600 focus-visible:ring-2 focus-visible:ring-teal-500/50 group-hover/metric-body:text-teal-600 dark:focus-visible:text-teal-400 dark:group-hover/metric-body:text-teal-400"
                >
                  {value}
                </Link>
              ) : (
                value
              )}
            </p>
            {comparison && (
              <StatisticsPeriodComparison
                {...comparison}
                translationKey={`${key}.comparison`}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MemberUsageDetails({ userID }: { userID: string }) {
  const { t, i18n } = useTranslation()
  const request = useStatistics<MemberAnalysis>(
    `/api/admin/v1/statistics/session-reporting/members/${encodeURIComponent(userID)}`
  )
  const number = new Intl.NumberFormat(i18n.language)
  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    ...TABLE_DATE_TIME_OPTIONS,
    timeZone: "Asia/Shanghai",
  })
  if (request.loading)
    return (
      <div
        className="flex min-h-96 items-center justify-center"
        role="status"
        aria-label={t("statistics.loading")}
      >
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      </div>
    )
  if (!request.data)
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-3">
        <p role="alert" className="text-sm text-muted-foreground">
          {request.error ?? t(`${key}.loadFailed`)}
        </p>
        <Button type="button" variant="outline" onClick={request.reload}>
          {t("statistics.retry")}
        </Button>
      </div>
    )
  const {
    member,
    summary,
    created_resources: createdResources,
    recent_tasks: recent,
    activity,
  } = request.data
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 items-center gap-3 rounded-lg border p-4">
        <UserAvatar
          src={member.avatar_url}
          className="size-10 data-[size=sm]:size-10"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{member.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {member.email}
          </p>
        </div>
        {member.groups.length > 0 && (
          <div className="ms-auto flex min-w-0 flex-wrap justify-end gap-1">
            {member.groups.map((group) => (
              <Badge
                key={group.id}
                variant="outline"
                className="max-w-40 truncate"
                title={group.name}
              >
                {group.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["tasks", "conversations", "credits"] as const).map((metric) => (
          <OverviewMetric
            key={metric}
            title={t(`${key}.metrics.${metric}`)}
            note={t(`${key}.metrics.${metric}`)}
            value={
              metric === "credits"
                ? credits(summary.credits, i18n.language)
                : number.format(summary[metric])
            }
            icon={detailMetricIcons[metric]}
            to={
              metric === "credits"
                ? undefined
                : `${metric === "tasks" ? CONSOLE_ROUTES.taskHistory : CONSOLE_ROUTES.conversationHistory}?${new URLSearchParams({ user_id: member.id })}`
            }
            textClassName={
              metric === "credits"
                ? "text-amber-600 dark:text-amber-400"
                : undefined
            }
            loading={false}
          />
        ))}
      </div>
      <Card
        className="min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
        role="region"
        aria-label={t(`${key}.createdResources`)}
      >
        <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
          <HugeiconsIcon
            icon={DocumentValidationIcon}
            className="shrink-0 text-muted-foreground"
            size={16}
            strokeWidth={1.75}
          />
          <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t(`${key}.createdResources`)}
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0 overflow-x-auto rounded-xl border border-border/60 bg-card p-0">
          <div className="grid min-w-[480px] grid-cols-6 divide-x divide-border/60 rtl:divide-x-reverse">
            {(
              [
                "models",
                "knowledge_bases",
                "skills",
                "experts",
                "connectors",
                "rules",
              ] as const
            ).map((resource) => (
              <div
                key={resource}
                role="group"
                aria-label={t(
                  `${key}.resourceKinds.${resource === "knowledge_bases" ? "knowledgeBases" : resource}`
                )}
                className="min-w-0 space-y-2 px-5 py-4 text-start"
              >
                <p className="text-xs text-muted-foreground">
                  {t(
                    `${key}.resourceKinds.${resource === "knowledge_bases" ? "knowledgeBases" : resource}`
                  )}
                </p>
                <p
                  className="break-words text-2xl font-medium tabular-nums tracking-tight"
                  title={
                    createdResources[resource] === null
                      ? t(`${key}.resourceUnavailable`)
                      : number.format(createdResources[resource])
                  }
                >
                  {createdResources[resource] === null
                    ? "—"
                    : number.format(createdResources[resource])}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <MemberActivityHeatmap
        userID={member.id}
        days={activity.days}
        until={new Date(`${activity.until}T12:00:00`)}
      />
      {summary.tasks === 0 &&
        summary.conversations === 0 &&
        Number(summary.credits) === 0 && (
          <div className="flex min-h-60 flex-col items-center justify-center gap-2 text-center">
            <HugeiconsIcon
              icon={Activity01Icon}
              className="mb-2 size-8 text-muted-foreground/60"
              strokeWidth={1.5}
            />
            <p className="font-medium">{t(`${key}.noUsage`)}</p>
            <p className="text-sm text-muted-foreground">
              {t(`${key}.noUsageHint`)}
            </p>
          </div>
        )}
      <section
        className="min-w-0 overflow-hidden rounded-lg border"
        aria-label={t(`${key}.recentTasks`)}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h3 className="font-medium">{t(`${key}.recentTasks`)}</h3>
          <Button
            variant="ghost"
            size="xs"
            render={
              <Link
                to={`${CONSOLE_ROUTES.taskHistory}?${new URLSearchParams({ user_id: member.id })}`}
              />
            }
          >
            {t(`${key}.showMore`)}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-4">{t(`${key}.taskName`)}</TableHead>
              <TableHead>
                {t("pages.taskHistory.columns.conversationCount")}
              </TableHead>
              <TableHead>{t(`${key}.createdAt`)}</TableHead>
              <TableHead className="pe-4">{t(`${key}.lastActiveAt`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.length ? (
              recent.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="ps-4 font-medium">
                    <Link
                      to={`${CONSOLE_ROUTES.conversationHistory}?${new URLSearchParams({ user_id: member.id, task_id: task.id })}`}
                      className="block max-w-96 truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      title={task.title}
                    >
                      {task.title}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {task.turn_count == null
                      ? "—"
                      : number.format(task.turn_count)}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={dateTime.format(new Date(task.started_at))}
                  >
                    {dateTime.format(new Date(task.started_at))}
                  </TableCell>
                  <TableCell
                    className="pe-4 text-muted-foreground"
                    title={dateTime.format(new Date(task.last_active_at))}
                  >
                    {dateTime.format(new Date(task.last_active_at))}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-24 text-center text-muted-foreground"
                >
                  {t("pages.taskHistory.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}

export function MemberAnalysisPage() {
  const { t, i18n } = useTranslation()
  const { data: overview, loading } = useStatistics<MemberOverview>(
    "/api/admin/v1/statistics/session-reporting/members/overview"
  )
  const overviewTrends = useMemo(
    () => ({
      newUsers: overview?.days.map((day) => ({
        date: day.date,
        count: day.new_members,
      })),
      activeUsers: overview?.days.map((day) => ({
        date: day.date,
        count: day.active_members,
      })),
    }),
    [overview]
  )
  const [params, setParams] = useSearchParams()
  const selectedID = params.get("user_id")
  const selectMember = (id: string | null) => {
    if (id === selectedID) return
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id) next.set("user_id", id)
        else next.delete("user_id")
        return next
      },
      { preventScrollReset: true }
    )
  }
  const pickerID = useId()
  const active7Days = overview?.last_7d.active_members
  const previous7Days = overview?.previous_7d.active_members
  const active24Hours = overview?.last_24h.active_members
  const previous24Hours = overview?.previous_24h.active_members
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  })
  const formatCount = (value?: number) =>
    value === undefined ? "—" : number.format(value)
  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-5 p-4 pt-0"
      aria-label={t(`${key}.title`)}
    >
      <div
        className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
        aria-label={t(`${key}.overview`)}
      >
        <OverviewMetric
          title={t(`${key}.totalMembers`)}
          value={formatCount(overview?.total_members)}
          loading={loading}
          note={t(`${key}.totalMembersNote`)}
          icon={UserMultiple02Icon}
        />
        <OverviewMetric
          title={t(`${key}.activeMembers`)}
          qualifier={t("pages.realtimeStatus.ranges.7d")}
          value={formatCount(active7Days)}
          loading={loading}
          note={t(`${key}.activeMembers7DaysNote`)}
          comparison={{
            current: active7Days,
            previous: previous7Days,
            periodLabel: t(`${key}.previous7Days`),
          }}
          icon={User02Icon}
        />
        <OverviewMetric
          title={t(`${key}.activeMembers`)}
          qualifier={t("pages.realtimeStatus.period24h")}
          value={formatCount(active24Hours)}
          loading={loading}
          note={t(`${key}.activeMembers24HoursNote`)}
          comparison={{
            current: active24Hours,
            previous: previous24Hours,
            periodLabel: t(`${key}.previous24Hours`),
          }}
          icon={Activity01Icon}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <StatisticsTrendCard
          icon={UserAdd01Icon}
          title={t("pages.realtimeStatus.newUsersTrend")}
          periodLabel={t("pages.realtimeStatus.period90d")}
          points={overviewTrends.newUsers}
          loading={loading}
          color="var(--color-orange-500)"
          barClassName="fill-orange-500"
        />
        <StatisticsTrendCard
          icon={User02Icon}
          title={t("pages.realtimeStatus.activeUsersTrend")}
          periodLabel={t("pages.realtimeStatus.period90d")}
          points={overviewTrends.activeUsers}
          loading={loading}
          color="var(--color-orange-400)"
          barClassName="fill-orange-400"
        />
      </div>
      <Card className="min-w-0 flex-1 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 px-3 py-0">
          <CardTitle className="min-w-0" role="heading" aria-level={2}>
            {t(`${key}.memberDetails`)}
          </CardTitle>
          <MemberPicker
            id={pickerID}
            userID={selectedID}
            onSelect={selectMember}
          />
        </CardHeader>
        <CardContent className="min-w-0 flex-1 rounded-xl border border-border/60 bg-card p-4">
          {selectedID ? (
            <MemberUsageDetails key={selectedID} userID={selectedID} />
          ) : (
            <div className="flex min-h-96 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-muted">
                <HugeiconsIcon
                  icon={User02Icon}
                  className="size-7 text-muted-foreground"
                  strokeWidth={1.5}
                />
              </div>
              <p className="font-medium">{t(`${key}.emptyTitle`)}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-1"
                onClick={() => {
                  const picker = document.getElementById(pickerID)
                  picker?.focus()
                  picker?.click()
                }}
              >
                {t(`${key}.selectMember`)}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
