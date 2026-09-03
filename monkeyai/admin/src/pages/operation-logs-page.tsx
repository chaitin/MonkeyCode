import { useMemo, useState, type KeyboardEvent } from "react"
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type LogCategory = "model" | "member" | "knowledge" | "security" | "settings"
type LogResult = "success" | "failed"
type LogAction =
  | "addModel"
  | "updateMemberRole"
  | "deleteKnowledgeBase"
  | "signIn"
  | "updateOAuth"
  | "createApiKey"
  | "updateRule"
  | "inviteMember"
  | "signInFailed"
  | "updateBranding"
  | "disableModel"
  | "exportLogs"

type AuditLog = {
  id: string
  occurredAt: string
  actor: string
  actorEmail: string
  initials: string
  action: LogAction
  category: LogCategory
  requestParams: Record<string, unknown>
  ipAddress: string
  result: LogResult
}

type CategoryFilter = "all" | LogCategory
type ResultFilter = "all" | LogResult

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]

const AUDIT_LOGS: AuditLog[] = [
  {
    id: "log-001",
    occurredAt: "2026-09-02T06:32:18Z",
    actor: "张明",
    actorEmail: "admin@example.com",
    initials: "ZM",
    action: "addModel",
    category: "model",
    requestParams: {
      provider: "openai",
      model: "gpt-5",
      context_window: 400000,
    },
    ipAddress: "203.0.113.24",
    result: "success",
  },
  {
    id: "log-002",
    occurredAt: "2026-09-02T05:48:06Z",
    actor: "李娜",
    actorEmail: "lina@example.com",
    initials: "LN",
    action: "updateMemberRole",
    category: "member",
    requestParams: { member_id: "usr_7h2k", role: "admin" },
    ipAddress: "198.51.100.17",
    result: "success",
  },
  {
    id: "log-003",
    occurredAt: "2026-09-02T03:15:42Z",
    actor: "张明",
    actorEmail: "admin@example.com",
    initials: "ZM",
    action: "deleteKnowledgeBase",
    category: "knowledge",
    requestParams: { knowledge_base_id: "kb_help_center", force: false },
    ipAddress: "203.0.113.24",
    result: "failed",
  },
  {
    id: "log-004",
    occurredAt: "2026-09-02T01:06:29Z",
    actor: "系统",
    actorEmail: "system@monkeyai.local",
    initials: "AI",
    action: "signIn",
    category: "security",
    requestParams: { method: "password" },
    ipAddress: "203.0.113.24",
    result: "success",
  },
  {
    id: "log-005",
    occurredAt: "2026-09-01T11:44:10Z",
    actor: "张明",
    actorEmail: "admin@example.com",
    initials: "ZM",
    action: "updateOAuth",
    category: "settings",
    requestParams: { provider: "github", enabled: true },
    ipAddress: "203.0.113.24",
    result: "success",
  },
  {
    id: "log-006",
    occurredAt: "2026-09-01T08:23:57Z",
    actor: "李娜",
    actorEmail: "lina@example.com",
    initials: "LN",
    action: "createApiKey",
    category: "security",
    requestParams: {
      name: "Production API Key",
      scopes: ["chat:write", "models:read"],
    },
    ipAddress: "198.51.100.17",
    result: "success",
  },
  {
    id: "log-007",
    occurredAt: "2026-08-31T09:17:33Z",
    actor: "张明",
    actorEmail: "admin@example.com",
    initials: "ZM",
    action: "updateRule",
    category: "settings",
    requestParams: { rule_id: "rule_masking", enabled: true },
    ipAddress: "203.0.113.24",
    result: "success",
  },
  {
    id: "log-008",
    occurredAt: "2026-08-31T06:02:11Z",
    actor: "李娜",
    actorEmail: "lina@example.com",
    initials: "LN",
    action: "inviteMember",
    category: "member",
    requestParams: {
      email: "wangqi@example.com",
      group_id: "grp_engineering",
    },
    ipAddress: "198.51.100.17",
    result: "success",
  },
  {
    id: "log-009",
    occurredAt: "2026-08-30T14:51:08Z",
    actor: "系统",
    actorEmail: "system@monkeyai.local",
    initials: "AI",
    action: "signInFailed",
    category: "security",
    requestParams: { method: "password", reason: "invalid_credentials" },
    ipAddress: "192.0.2.86",
    result: "failed",
  },
  {
    id: "log-010",
    occurredAt: "2026-08-30T04:35:49Z",
    actor: "张明",
    actorEmail: "admin@example.com",
    initials: "ZM",
    action: "updateBranding",
    category: "settings",
    requestParams: {
      workspace_name: "MonkeyAI Workspace",
      logo_changed: true,
    },
    ipAddress: "203.0.113.24",
    result: "success",
  },
  {
    id: "log-011",
    occurredAt: "2026-08-29T10:28:22Z",
    actor: "李娜",
    actorEmail: "lina@example.com",
    initials: "LN",
    action: "disableModel",
    category: "model",
    requestParams: { model_id: "claude-3-5-sonnet" },
    ipAddress: "198.51.100.17",
    result: "success",
  },
  {
    id: "log-012",
    occurredAt: "2026-08-29T02:13:04Z",
    actor: "张明",
    actorEmail: "admin@example.com",
    initials: "ZM",
    action: "exportLogs",
    category: "security",
    requestParams: { range: "2026-08", format: "csv" },
    ipAddress: "203.0.113.24",
    result: "success",
  },
]

const CATEGORY_FILTERS: CategoryFilter[] = [
  "all",
  "model",
  "member",
  "knowledge",
  "security",
  "settings",
]
const RESULT_FILTERS: ResultFilter[] = ["all", "success", "failed"]

export function OperationLogsPage() {
  const { i18n, t } = useTranslation()
  const [operatorInput, setOperatorInput] = useState("")
  const [ipInput, setIpInput] = useState("")
  const [requestParamsInput, setRequestParamsInput] = useState("")
  const [categoryInput, setCategoryInput] = useState<CategoryFilter>("all")
  const [resultInput, setResultInput] = useState<ResultFilter>("all")
  const [operatorQuery, setOperatorQuery] = useState("")
  const [ipQuery, setIpQuery] = useState("")
  const [requestParamsQuery, setRequestParamsQuery] = useState("")
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [result, setResult] = useState<ResultFilter>("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const categoryLabel = (value: CategoryFilter) =>
    value === "all"
      ? t("pages.operationLogs.filters.allActions")
      : t(`pages.operationLogs.categories.${value}`)
  const resultLabel = (value: ResultFilter) =>
    value === "all"
      ? t("pages.operationLogs.filters.allResults")
      : t(`pages.operationLogs.results.${value}`)

  const filteredLogs = useMemo(() => {
    const normalizedOperatorQuery = operatorQuery
      .trim()
      .toLocaleLowerCase(i18n.language)
    const normalizedIpQuery = ipQuery.trim().toLocaleLowerCase(i18n.language)
    const normalizedRequestParamsQuery = requestParamsQuery
      .trim()
      .toLocaleLowerCase(i18n.language)

    return AUDIT_LOGS.filter((log) => {
      const matchesCategory = category === "all" || log.category === category
      const matchesResult = result === "all" || log.result === result
      const matchesOperator =
        normalizedOperatorQuery.length === 0 ||
        [log.actor, log.actorEmail].some((value) =>
          value
            .toLocaleLowerCase(i18n.language)
            .includes(normalizedOperatorQuery)
        )
      const matchesIp =
        normalizedIpQuery.length === 0 ||
        log.ipAddress.includes(normalizedIpQuery)
      const matchesRequestParams =
        normalizedRequestParamsQuery.length === 0 ||
        JSON.stringify(log.requestParams)
          .toLocaleLowerCase(i18n.language)
          .includes(normalizedRequestParamsQuery)

      return (
        matchesCategory &&
        matchesResult &&
        matchesOperator &&
        matchesIp &&
        matchesRequestParams
      )
    })
  }, [
    category,
    i18n.language,
    ipQuery,
    operatorQuery,
    requestParamsQuery,
    result,
  ])

  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const visibleLogs = filteredLogs.slice(pageStart, pageStart + pageSize)
  const firstVisible = filteredLogs.length === 0 ? 0 : pageStart + 1
  const lastVisible = Math.min(pageStart + pageSize, filteredLogs.length)
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [i18n.language]
  )

  const updateCategory = (value: string) => {
    setCategoryInput(value as CategoryFilter)
  }

  const updateResult = (value: string) => {
    setResultInput(value as ResultFilter)
  }

  const applySearch = () => {
    setOperatorQuery(operatorInput)
    setIpQuery(ipInput)
    setRequestParamsQuery(requestParamsInput)
    setCategory(categoryInput)
    setResult(resultInput)
    setPage(1)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      applySearch()
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-0">
      <Card>
        <CardContent className="gap-4 px-0">
          <div className="flex flex-wrap items-center gap-2 px-(--card-spacing)">
            <Input
              className="w-48"
              value={operatorInput}
              onChange={(event) => setOperatorInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t(
                "pages.operationLogs.filters.operatorSearchPlaceholder"
              )}
              aria-label={t(
                "pages.operationLogs.filters.operatorSearchPlaceholder"
              )}
            />
            <Input
              className="w-48"
              value={ipInput}
              onChange={(event) => setIpInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("pages.operationLogs.filters.ipSearchPlaceholder")}
              aria-label={t("pages.operationLogs.filters.ipSearchPlaceholder")}
            />
            <Input
              className="w-48"
              value={requestParamsInput}
              onChange={(event) => setRequestParamsInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t(
                "pages.operationLogs.filters.requestParamsSearchPlaceholder"
              )}
              aria-label={t(
                "pages.operationLogs.filters.requestParamsSearchPlaceholder"
              )}
            />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {categoryLabel(categoryInput)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.operationLogs.filters.actionType")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={categoryInput}
                    onValueChange={updateCategory}
                  >
                    {CATEGORY_FILTERS.map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {categoryLabel(value)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {resultLabel(resultInput)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.operationLogs.filters.result")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={resultInput}
                    onValueChange={updateResult}
                  >
                    {RESULT_FILTERS.map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {resultLabel(value)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" onClick={applySearch}>
              <HugeiconsIcon icon={Search02Icon} data-icon="inline-start" />
              {t("pages.operationLogs.filters.search")}
            </Button>
          </div>
          <Table className="min-w-4xl">
            <TableHeader>
              <TableRow>
                <TableHead className="ps-(--card-spacing)">
                  {t("pages.operationLogs.columns.time")}
                </TableHead>
                <TableHead>
                  {t("pages.operationLogs.columns.operator")}
                </TableHead>
                <TableHead>{t("pages.operationLogs.columns.action")}</TableHead>
                <TableHead>
                  {t("pages.operationLogs.columns.requestParams")}
                </TableHead>
                <TableHead>
                  {t("pages.operationLogs.columns.ipAddress")}
                </TableHead>
                <TableHead className="pe-(--card-spacing)">
                  {t("pages.operationLogs.columns.result")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLogs.length > 0 ? (
                visibleLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="ps-(--card-spacing) text-muted-foreground">
                      {dateFormatter.format(new Date(log.occurredAt))}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex max-w-52 items-center gap-3"
                        title={log.actorEmail}
                      >
                        <Avatar className="size-6">
                          <AvatarFallback>{log.initials}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">
                          {log.actor}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {t(`pages.operationLogs.actions.${log.action}`)}
                    </TableCell>
                    <TableCell>
                      <code
                        className="block max-w-80 truncate text-xs text-muted-foreground"
                        title={JSON.stringify(log.requestParams)}
                      >
                        {JSON.stringify(log.requestParams)}
                      </code>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {log.ipAddress}
                    </TableCell>
                    <TableCell className="pe-(--card-spacing)">
                      <Badge
                        variant={
                          log.result === "success" ? "secondary" : "destructive"
                        }
                      >
                        {resultLabel(log.result)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground"
                  >
                    {t("pages.operationLogs.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 px-(--card-spacing)">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                items={pageSizeItems}
                value={String(pageSize)}
                onValueChange={(value) => {
                  if (value !== null) {
                    setPageSize(Number(value))
                    setPage(1)
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t(
                    "pages.operationLogs.pagination.pageSizeLabel"
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} align="start">
                  <SelectGroup>
                    {pageSizeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {t("pages.operationLogs.pagination.summary", {
                  from: firstVisible,
                  to: lastVisible,
                  total: filteredLogs.length,
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("pages.operationLogs.pagination.page", {
                  page: currentPage,
                  pages: pageCount,
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={currentPage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                aria-label={t("pages.operationLogs.pagination.previous")}
              >
                <HugeiconsIcon
                  icon={ArrowLeft02Icon}
                  className="rtl:rotate-180"
                />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={currentPage === pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
                aria-label={t("pages.operationLogs.pagination.next")}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="rtl:rotate-180"
                />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
