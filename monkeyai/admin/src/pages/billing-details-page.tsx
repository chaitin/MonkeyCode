import { useMemo, useState, type KeyboardEvent } from "react"
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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

type BillingCategory = "model" | "tool" | "knowledge" | "other"
type BillingCategoryFilter = "all" | BillingCategory
type UsageUnit = "tokens" | "calls" | "documents"

type BillingRecord = {
  id: string
  occurredAt: string
  user: string
  email: string
  initials: string
  category: BillingCategory
  item: string
  quantity: number
  usageUnit: UsageUnit
  credits: number
  balance: number
}

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]
const CATEGORY_FILTERS: BillingCategoryFilter[] = [
  "all",
  "model",
  "tool",
  "knowledge",
  "other",
]

const BILLING_RECORDS: BillingRecord[] = [
  {
    id: "billing-001",
    occurredAt: "2026-09-03T03:42:18Z",
    user: "林玫",
    email: "lin.mei@example.com",
    initials: "LM",
    category: "model",
    item: "GPT-5 · Input",
    quantity: 12480,
    usageUnit: "tokens",
    credits: 1.25,
    balance: 9842.35,
  },
  {
    id: "billing-002",
    occurredAt: "2026-09-03T03:42:18Z",
    user: "林玫",
    email: "lin.mei@example.com",
    initials: "LM",
    category: "model",
    item: "GPT-5 · Output",
    quantity: 3260,
    usageUnit: "tokens",
    credits: 1.3,
    balance: 9841.05,
  },
  {
    id: "billing-003",
    occurredAt: "2026-09-03T03:39:02Z",
    user: "陈晨",
    email: "chen.chen@example.com",
    initials: "CC",
    category: "tool",
    item: "Web Search",
    quantity: 1,
    usageUnit: "calls",
    credits: 2,
    balance: 18724,
  },
  {
    id: "billing-004",
    occurredAt: "2026-09-03T02:55:46Z",
    user: "Alice Zhang",
    email: "alice.zhang@example.com",
    initials: "AZ",
    category: "knowledge",
    item: "bge-m3 Embedding",
    quantity: 8,
    usageUnit: "documents",
    credits: 4.8,
    balance: 49221.6,
  },
  {
    id: "billing-005",
    occurredAt: "2026-09-03T02:31:14Z",
    user: "王伟",
    email: "wang.wei@example.com",
    initials: "WW",
    category: "model",
    item: "Claude 3.5 Sonnet · Input",
    quantity: 28600,
    usageUnit: "tokens",
    credits: 2.86,
    balance: 27649.14,
  },
  {
    id: "billing-006",
    occurredAt: "2026-09-03T02:31:14Z",
    user: "王伟",
    email: "wang.wei@example.com",
    initials: "WW",
    category: "model",
    item: "Claude 3.5 Sonnet · Output",
    quantity: 5920,
    usageUnit: "tokens",
    credits: 2.37,
    balance: 27646.77,
  },
  {
    id: "billing-007",
    occurredAt: "2026-09-03T01:48:37Z",
    user: "李娜",
    email: "li.na@example.com",
    initials: "LN",
    category: "tool",
    item: "Browser Automation",
    quantity: 3,
    usageUnit: "calls",
    credits: 6,
    balance: 13880.5,
  },
  {
    id: "billing-008",
    occurredAt: "2026-09-02T14:22:09Z",
    user: "Omar Hassan",
    email: "omar.hassan@example.com",
    initials: "OH",
    category: "other",
    item: "Content enhancement",
    quantity: 1,
    usageUnit: "calls",
    credits: 3.5,
    balance: 46310.25,
  },
  {
    id: "billing-009",
    occurredAt: "2026-09-02T13:15:31Z",
    user: "Sophia Chen",
    email: "sophia.chen@example.com",
    initials: "SC",
    category: "knowledge",
    item: "bge-reranker-v2-m3",
    quantity: 1,
    usageUnit: "calls",
    credits: 0.5,
    balance: 19405.75,
  },
  {
    id: "billing-010",
    occurredAt: "2026-09-02T11:06:44Z",
    user: "陈晨",
    email: "chen.chen@example.com",
    initials: "CC",
    category: "model",
    item: "DeepSeek Chat · Cached input",
    quantity: 45600,
    usageUnit: "tokens",
    credits: 0.91,
    balance: 18726,
  },
  {
    id: "billing-011",
    occurredAt: "2026-09-02T09:51:26Z",
    user: "Priya Patel",
    email: "priya.patel@example.com",
    initials: "PP",
    category: "tool",
    item: "GitHub MCP",
    quantity: 5,
    usageUnit: "calls",
    credits: 2.5,
    balance: 16892.2,
  },
  {
    id: "billing-012",
    occurredAt: "2026-09-02T08:17:05Z",
    user: "Lucas Martin",
    email: "lucas.martin@example.com",
    initials: "LM",
    category: "knowledge",
    item: "Document parsing enhancement",
    quantity: 2,
    usageUnit: "documents",
    credits: 4,
    balance: 17201,
  },
]

export function BillingDetailsPage() {
  const { i18n, t } = useTranslation()
  const [userInput, setUserInput] = useState("")
  const [itemInput, setItemInput] = useState("")
  const [categoryInput, setCategoryInput] =
    useState<BillingCategoryFilter>("all")
  const [userQuery, setUserQuery] = useState("")
  const [itemQuery, setItemQuery] = useState("")
  const [category, setCategory] = useState<BillingCategoryFilter>("all")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const categoryLabel = (value: BillingCategoryFilter) =>
    value === "all"
      ? t("pages.billingDetails.filters.allCategories")
      : t(`pages.billingDetails.categories.${value}`)

  const filteredRecords = useMemo(() => {
    const normalizedUser = userQuery.trim().toLocaleLowerCase(i18n.language)
    const normalizedItem = itemQuery.trim().toLocaleLowerCase(i18n.language)

    return BILLING_RECORDS.filter((record) => {
      const matchesCategory = category === "all" || record.category === category
      const matchesUser =
        !normalizedUser ||
        [record.user, record.email].some((value) =>
          value.toLocaleLowerCase(i18n.language).includes(normalizedUser)
        )
      const matchesItem =
        !normalizedItem ||
        record.item.toLocaleLowerCase(i18n.language).includes(normalizedItem)

      return matchesCategory && matchesUser && matchesItem
    })
  }, [category, i18n.language, itemQuery, userQuery])

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const visibleRecords = filteredRecords.slice(pageStart, pageStart + pageSize)
  const firstVisible = filteredRecords.length === 0 ? 0 : pageStart + 1
  const lastVisible = Math.min(pageStart + pageSize, filteredRecords.length)
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
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }),
    [i18n.language]
  )
  const billingContent = (record: BillingRecord) =>
    t(`pages.billingDetails.content.${record.usageUnit}`, {
      item: record.item,
      count: numberFormatter.format(record.quantity),
    })

  const applySearch = () => {
    setUserQuery(userInput)
    setItemQuery(itemInput)
    setCategory(categoryInput)
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
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("pages.billingDetails.filters.userPlaceholder")}
              aria-label={t("pages.billingDetails.filters.userPlaceholder")}
            />
            <Input
              className="w-48"
              value={itemInput}
              onChange={(event) => setItemInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("pages.billingDetails.filters.itemPlaceholder")}
              aria-label={t("pages.billingDetails.filters.itemPlaceholder")}
            />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {categoryLabel(categoryInput)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.billingDetails.filters.category")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={categoryInput}
                    onValueChange={(value) =>
                      setCategoryInput(value as BillingCategoryFilter)
                    }
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
            <Button type="button" onClick={applySearch}>
              <HugeiconsIcon icon={Search02Icon} data-icon="inline-start" />
              {t("pages.billingDetails.filters.search")}
            </Button>
          </div>

          <Table className="min-w-5xl">
            <TableHeader>
              <TableRow>
                <TableHead className="ps-(--card-spacing)">
                  {t("pages.billingDetails.columns.time")}
                </TableHead>
                <TableHead>{t("pages.billingDetails.columns.user")}</TableHead>
                <TableHead>
                  {t("pages.billingDetails.columns.category")}
                </TableHead>
                <TableHead>
                  {t("pages.billingDetails.columns.content")}
                </TableHead>
                <TableHead className="text-end">
                  {t("pages.billingDetails.columns.credits")}
                </TableHead>
                <TableHead className="pe-(--card-spacing) text-end">
                  {t("pages.billingDetails.columns.balance")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRecords.length > 0 ? (
                visibleRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="ps-(--card-spacing) text-muted-foreground">
                      {dateFormatter.format(new Date(record.occurredAt))}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex max-w-52 items-center gap-3"
                        title={record.email}
                      >
                        <Avatar className="size-6">
                          <AvatarFallback>{record.initials}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">
                          {record.user}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{categoryLabel(record.category)}</TableCell>
                    <TableCell
                      className="max-w-96 text-muted-foreground"
                      title={billingContent(record)}
                    >
                      {billingContent(record)}
                    </TableCell>
                    <TableCell className="text-end font-medium">
                      -{numberFormatter.format(record.credits)}
                    </TableCell>
                    <TableCell className="pe-(--card-spacing) text-end font-mono text-muted-foreground">
                      {numberFormatter.format(record.balance)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground"
                  >
                    {t("pages.billingDetails.empty")}
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
                  aria-label={t("pages.operationLogs.pagination.pageSizeLabel")}
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
                  total: filteredRecords.length,
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
