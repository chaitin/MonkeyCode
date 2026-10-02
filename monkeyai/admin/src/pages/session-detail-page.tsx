import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams, useSearchParams } from "react-router-dom"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CONSOLE_ROUTES } from "@/lib/routes"
import {
  defaultWindow,
  reportPaths,
  reportQuery,
  useReport,
  type ReportDetail,
  type ReportWindow,
} from "@/lib/session-reporting"
import {
  ReportNumber,
  ReportShell,
  ReportStatus,
  ReportTime,
  ReportValue,
} from "@/pages/session-reporting-page"

const key = "pages.sessionReporting"

function DetailTable<T>({
  title,
  columns,
  rows,
  render,
}: {
  title: string
  columns: string[]
  rows: T[]
  render: (row: T, index: number) => React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("statistics.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>
                    {t(`${key}.fields.${column}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>{rows.map(render)}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function SessionDetailPage() {
  const { t } = useTranslation()
  const { sessionId = "" } = useParams()
  const [params] = useSearchParams()
  const [expanded, setExpanded] = useState<number | null>(null)
  const time = defaultWindow()
  const from = params.get("from")
  const until = params.get("until")
  const window: ReportWindow =
    from &&
    until &&
    !Number.isNaN(Date.parse(from)) &&
    !Number.isNaN(Date.parse(until)) &&
    Date.parse(from) < Date.parse(until)
      ? { from, until }
      : time
  const valid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId
    )
  const request = useReport<ReportDetail>(
    reportPaths.detail(valid ? sessionId : "invalid") + reportQuery(window)
  )
  const data =
    valid && request.data?.id === sessionId ? request.data : undefined
  const fields: (keyof ReportDetail)[] = [
    "id",
    "owner_user_id",
    "group_id",
    "expert_id",
    "parent_session_id",
    "model_id",
    "client_type",
    "client_version",
    "engine_version",
    "runtime_version",
    "started_at",
    "last_active_at",
    "ended_at",
    "updated_at",
    "active_seconds",
    "last_outcome",
    "credits",
    "placeholder",
    "clock_suspect",
  ]
  return (
    <ReportShell title={t(`${key}.detail.title`)}>
      <div>
        <Link
          to={CONSOLE_ROUTES.sessionList}
          className="text-sm text-primary underline"
        >
          {t(`${key}.back`)}
        </Link>
      </div>
      {!valid ? (
        <p role="alert" className="text-destructive">
          {t(`${key}.invalidFilter`)}
        </p>
      ) : (
        <ReportStatus request={request} />
      )}
      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="break-all">{data.id}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((field) => (
                <div key={field} className="text-sm">
                  <p className="text-xs text-muted-foreground">
                    {t(`${key}.fields.${field}`)}
                  </p>
                  {field.endsWith("_at") ? (
                    <ReportTime value={data[field] as string | null} />
                  ) : (
                    <ReportValue
                      value={data[field] as string | number | boolean | null}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            {t(`${key}.window`)}: <ReportTime value={data.from} /> –{" "}
            <ReportTime value={data.until} /> ·{" "}
            {t(`${key}.generated`, {
              time: new Date(data.generated_at).toLocaleString(),
            })}{" "}
            · {t(`${key}.detail.limit`, { count: data.detail_limit })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`${key}.detail.clearNotice`)}
          </p>
          <Tabs defaultValue="turns">
            <TabsList>
              {(["turns", "resources", "calls", "subsessions"] as const).map(
                (tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    {t(`${key}.detail.${tab}`)}
                  </TabsTrigger>
                )
              )}
            </TabsList>
            <TabsContent value="turns" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {t(`${key}.detail.usageNote`)}
              </p>
              <DetailTable
                title={t(`${key}.detail.turns`)}
                columns={[
                  "turn_index",
                  "input_kind",
                  "started_at",
                  "ended_at",
                  "duration_seconds",
                  "outcome",
                  "error_code",
                  "input_tokens",
                  "output_tokens",
                  "tools",
                  "skills",
                  "resources_snapshot_id",
                ]}
                rows={data.turns}
                render={(row) => (
                  <TableRow
                    key={row.turn_index}
                    onClick={() =>
                      setExpanded(
                        expanded === row.turn_index ? null : row.turn_index
                      )
                    }
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={expanded === row.turn_index}
                      >
                        {row.turn_index}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <ReportValue value={row.input_kind} />
                    </TableCell>
                    <TableCell>
                      <ReportTime value={row.started_at} />
                    </TableCell>
                    <TableCell>
                      <ReportTime value={row.ended_at} />
                    </TableCell>
                    {[
                      row.duration_seconds,
                      row.outcome,
                      row.error_code,
                      row.input_tokens,
                      row.output_tokens,
                      row.tools,
                      row.skills,
                      row.resources_snapshot_id,
                    ].map((value, index) => (
                      <TableCell key={index}>
                        <ReportValue value={value} />
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              />
              {expanded !== null && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailTable
                    title={t(`${key}.detail.tools`)}
                    columns={[
                      "category",
                      "resource_id",
                      "resource_version",
                      "calls",
                      "failed",
                      "duration_ms",
                    ]}
                    rows={data.tools.filter(
                      (item) => item.turn_index === expanded
                    )}
                    render={(row, index) => (
                      <TableRow key={index}>
                        {[
                          row.category,
                          row.resource_id,
                          row.resource_version,
                          row.calls,
                          row.failed,
                          row.duration_ms,
                        ].map((v, i) => (
                          <TableCell key={i}>
                            <ReportValue value={v} />
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                  />
                  <DetailTable
                    title={t(`${key}.detail.skills`)}
                    columns={[
                      "skill_id",
                      "version",
                      "trigger",
                      "events",
                      "succeeded",
                    ]}
                    rows={data.skills.filter(
                      (item) => item.turn_index === expanded
                    )}
                    render={(row, index) => (
                      <TableRow key={index}>
                        {[
                          row.skill_id,
                          row.version,
                          row.trigger,
                          row.events,
                          row.succeeded,
                        ].map((v, i) => (
                          <TableCell key={i}>
                            <ReportValue value={v} />
                          </TableCell>
                        ))}
                      </TableRow>
                    )}
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent value="resources">
              <DetailTable
                title={t(`${key}.detail.resources`)}
                columns={[
                  "kind",
                  "resource_id",
                  "version",
                  "enabled",
                  "available",
                  "snapshots",
                ]}
                rows={data.resources}
                render={(row, index) => (
                  <TableRow key={index}>
                    {[
                      row.kind,
                      row.resource_id,
                      row.version,
                      row.enabled,
                      row.available,
                      row.snapshots,
                    ].map((v, i) => (
                      <TableCell key={i}>
                        <ReportValue value={v} />
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              />
            </TabsContent>
            <TabsContent value="calls">
              <p className="mb-4 text-xs text-muted-foreground">
                {t(`${key}.detail.callsNote`)}
              </p>
              <DetailTable
                title={t(`${key}.detail.calls`)}
                columns={[
                  "kind",
                  "status",
                  "calls",
                  "input_tokens",
                  "output_tokens",
                ]}
                rows={data.calls}
                render={(row, index) => (
                  <TableRow key={index}>
                    {[
                      row.kind,
                      row.status,
                      row.calls,
                      row.input_tokens,
                      row.output_tokens,
                    ].map((v, i) => (
                      <TableCell key={i}>
                        <ReportValue value={v} />
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              />
            </TabsContent>
            <TabsContent value="subsessions">
              <DetailTable
                title={t(`${key}.detail.subsessions`)}
                columns={[
                  "session_id",
                  "parent_session_id",
                  "started_at",
                  "turns",
                  "last_outcome",
                  "active_seconds",
                ]}
                rows={data.subsessions}
                render={(row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        className="text-primary underline"
                        to={`${CONSOLE_ROUTES.sessionDetail.replace(":sessionId", row.id)}${reportQuery(window)}`}
                      >
                        {row.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ReportValue value={row.parent_session_id} />
                    </TableCell>
                    <TableCell>
                      <ReportTime value={row.started_at} />
                    </TableCell>
                    <TableCell>
                      <ReportNumber value={row.turns} />
                    </TableCell>
                    <TableCell>
                      <ReportValue value={row.last_outcome} />
                    </TableCell>
                    <TableCell>
                      <ReportNumber value={row.active_seconds} suffix="s" />
                    </TableCell>
                  </TableRow>
                )}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </ReportShell>
  )
}
