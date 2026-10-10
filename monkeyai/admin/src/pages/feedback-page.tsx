import { useEffect, useMemo, useState } from "react"
import { User02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { AccountDialog } from "@/components/billing/account-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { api } from "@/lib/api"

type Category = "bug" | "feature" | "experience" | "other"
type State = "uploading" | "new" | "resolved" | "ignored" | "failed"
type EditableState = "new" | "resolved" | "ignored"
type Attachment = {
  id: string
  mime_type: string
  byte_size: number
  width: number
  height: number
  state: "pending" | "ready" | "failed"
  downloadable: boolean
}
type Feedback = {
  id: string
  user_id: string
  user_name?: string
  user_email?: string
  category: Category
  content: string
  rating?: number | null
  platform: string
  client_version: string
  state: State
  request_id?: string
  created_at: string
  updated_at: string
  attachments: Attachment[]
}
type FeedbackPageData = {
  items: Feedback[]
  total: number
  page: number
  page_size: number
}

const categories: Category[] = ["bug", "feature", "experience", "other"]
const states: State[] = ["uploading", "new", "resolved", "ignored", "failed"]
const editableStates: EditableState[] = ["new", "resolved", "ignored"]
const pageSize = 20

function isEditable(state: State): state is EditableState {
  return state === "new" || state === "resolved" || state === "ignored"
}

function feedbackPath(id: string) {
  return `/api/admin/v1/feedback/${encodeURIComponent(id)}`
}

function StateBadge({ state }: { state: State }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant={
        state === "resolved"
          ? "successOutline"
          : state === "failed"
            ? "destructive"
            : state === "new"
              ? "warningOutline"
              : "outline"
      }
    >
      {t(`pages.feedback.states.${state}`)}
    </Badge>
  )
}

function FeedbackDetails({
  id,
  onUpdated,
}: {
  id: string
  onUpdated: () => void
}) {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [response, setResponse] = useState<{
    key: string
    data?: Feedback
    error?: string
  }>()
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [nextState, setNextState] = useState<EditableState>("new")
  const locale = i18n.resolvedLanguage ?? i18n.language
  const requestKey = `${id}:${revision}`
  const loading = response?.key !== requestKey
  const data = loading ? undefined : response.data
  const loadError = loading ? "" : (response.error ?? "")

  useEffect(() => {
    const controller = new AbortController()
    api<Feedback>(feedbackPath(id), { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setResponse({ key: requestKey, data: result })
        if (isEditable(result.state)) setNextState(result.state)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setResponse({
            key: requestKey,
            error: reason instanceof Error ? reason.message : String(reason),
          })
        }
      })
    return () => controller.abort()
  }, [id, requestKey])

  async function saveState() {
    if (!data || !isEditable(data.state) || saving || nextState === data.state)
      return
    setSaving(true)
    setError("")
    try {
      const result = await api<Feedback>(feedbackPath(id), {
        method: "PATCH",
        body: JSON.stringify({ state: nextState }),
      })
      setResponse({ key: requestKey, data: result })
      onUpdated()
      showToast({ status: "success", title: t("pages.feedback.saved") })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      showToast({ status: "error", title: message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status">{t("resources.loading")}</p>
  if (loadError) {
    return (
      <div role="alert" className="space-y-3">
        <p>
          {t("pages.feedback.loadError")}: {loadError}
        </p>
        <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
          {t("pages.feedback.retry")}
        </Button>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-5 overflow-y-auto pe-1">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {[
          [
            t("pages.feedback.submittedAt"),
            new Date(data.created_at).toLocaleString(locale),
          ],
          [t("pages.feedback.userId"), data.user_id],
          [
            t("pages.feedback.columns.category"),
            t(`pages.feedback.categories.${data.category}`),
          ],
          [t("pages.feedback.columns.rating"), data.rating ?? "—"],
          [t("pages.feedback.platform"), data.platform],
          [t("pages.feedback.version"), data.client_version || "—"],
          [t("pages.feedback.requestId"), data.request_id || "—"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-muted-foreground">{t("pages.feedback.state")}</dt>
          <dd className="mt-1">
            <StateBadge state={data.state} />
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="mb-2 font-medium">{t("pages.feedback.content")}</h3>
        <p className="rounded-md bg-muted p-3 break-words whitespace-pre-wrap">
          {data.content || t("pages.feedback.noContent")}
        </p>
      </div>
      <div>
        <h3 className="mb-2 font-medium">{t("pages.feedback.images")}</h3>
        {data.attachments.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.attachments.map((attachment, index) => {
              if (!attachment.downloadable) {
                return (
                  <div
                    key={attachment.id}
                    className="rounded-md border p-4 text-muted-foreground"
                  >
                    {t("pages.feedback.unavailableImage")}
                  </div>
                )
              }
              const path = `${feedbackPath(id)}/attachments/${encodeURIComponent(attachment.id)}`
              return (
                <a
                  key={attachment.id}
                  href={path}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("pages.feedback.openImage")}
                  className="block rounded-md border p-2 hover:bg-muted"
                >
                  <img
                    src={path}
                    alt={t("pages.feedback.imageAlt", { index: index + 1 })}
                    loading="lazy"
                    className="max-h-64 w-full rounded object-contain"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {attachment.width} × {attachment.height} ·{" "}
                    {t("pages.feedback.openImage")}
                  </span>
                </a>
              )
            })}
          </div>
        ) : (
          <p className="text-muted-foreground">
            {t("pages.feedback.noImages")}
          </p>
        )}
      </div>
      {isEditable(data.state) && (
        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <Select
            items={editableStates.map((value) => ({
              value,
              label: t(`pages.feedback.states.${value}`),
            }))}
            value={nextState}
            onValueChange={(value) => {
              if (value && isEditable(value as State))
                setNextState(value as EditableState)
            }}
          >
            <SelectTrigger aria-label={t("pages.feedback.changeState")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {editableStates.map((state) => (
                  <SelectItem key={state} value={state}>
                    {t(`pages.feedback.states.${state}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            disabled={saving || nextState === data.state}
            onClick={saveState}
          >
            {saving ? t("resources.saving") : t("pages.feedback.save")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function FeedbackPage() {
  const { i18n, t } = useTranslation()
  const [category, setCategory] = useState<Category | "all">("all")
  const [state, setState] = useState<State | "all">("all")
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [accountUserID, setAccountUserID] = useState<string | null>(null)
  const [response, setResponse] = useState<{
    key: string
    data?: FeedbackPageData
    error?: string
  }>()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [locale]
  )
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  if (category !== "all") query.set("category", category)
  if (state !== "all") query.set("state", state)
  const path = `/api/admin/v1/feedback?${query}`
  const requestKey = `${path}:${revision}`
  const loading = response?.key !== requestKey
  const error = loading ? "" : (response.error ?? "")
  const data = loading ? undefined : response.data

  useEffect(() => {
    const controller = new AbortController()
    api<FeedbackPageData>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          setResponse({ key: requestKey, data: result })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setResponse({
            key: requestKey,
            error: reason instanceof Error ? reason.message : String(reason),
          })
        }
      })
    return () => controller.abort()
  }, [path, requestKey])

  const rows = !loading && !error ? (data?.items ?? []) : []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <div className="flex flex-wrap items-center gap-3 px-(--card-spacing)">
            <Select
              items={[
                { value: "all", label: t("pages.feedback.allCategories") },
                ...categories.map((value) => ({
                  value,
                  label: t(`pages.feedback.categories.${value}`),
                })),
              ]}
              value={category}
              onValueChange={(value) => {
                if (value) {
                  setCategory(value as Category | "all")
                  setPage(1)
                }
              }}
            >
              <SelectTrigger aria-label={t("pages.feedback.category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">
                    {t("pages.feedback.allCategories")}
                  </SelectItem>
                  {categories.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`pages.feedback.categories.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={[
                { value: "all", label: t("pages.feedback.allStates") },
                ...states.map((value) => ({
                  value,
                  label: t(`pages.feedback.states.${value}`),
                })),
              ]}
              value={state}
              onValueChange={(value) => {
                if (value) {
                  setState(value as State | "all")
                  setPage(1)
                }
              }}
            >
              <SelectTrigger aria-label={t("pages.feedback.state")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">
                    {t("pages.feedback.allStates")}
                  </SelectItem>
                  {states.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`pages.feedback.states.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("statistics.refresh")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table aria-label={t("pages.feedback.title")} aria-busy={loading}>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="ps-(--card-spacing)">
                    {t("pages.feedback.columns.time")}
                  </TableHead>
                  <TableHead>{t("pages.feedback.columns.user")}</TableHead>
                  <TableHead>{t("pages.feedback.columns.category")}</TableHead>
                  <TableHead>{t("pages.feedback.columns.content")}</TableHead>
                  <TableHead>{t("pages.feedback.columns.rating")}</TableHead>
                  <TableHead>{t("pages.feedback.columns.state")}</TableHead>
                  <TableHead className="pe-(--card-spacing)">
                    {t("pages.feedback.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="ps-(--card-spacing) text-muted-foreground">
                        {formatter.format(new Date(item.created_at))}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="flex max-w-52 cursor-pointer items-center gap-3 rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          title={item.user_email || item.user_id}
                          onClick={() => setAccountUserID(item.user_id)}
                        >
                          <HugeiconsIcon
                            icon={User02Icon}
                            className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {item.user_name || item.user_id}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        {t(`pages.feedback.categories.${item.category}`)}
                      </TableCell>
                      <TableCell
                        className="max-w-80 truncate"
                        title={item.content}
                      >
                        {item.content || t("pages.feedback.noContent")}
                      </TableCell>
                      <TableCell>{item.rating ?? "—"}</TableCell>
                      <TableCell>
                        <StateBadge state={item.state} />
                      </TableCell>
                      <TableCell className="pe-(--card-spacing)">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setSelectedId(item.id)}
                        >
                          {t("pages.feedback.view")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-muted-foreground"
                    >
                      {loading ? (
                        t("resources.loading")
                      ) : error ? (
                        <div role="alert" className="space-y-2">
                          <p>
                            {t("pages.feedback.loadError")}: {error}
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => setRevision((n) => n + 1)}
                          >
                            {t("pages.feedback.retry")}
                          </Button>
                        </div>
                      ) : (
                        t("pages.feedback.empty")
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-(--card-spacing) text-sm text-muted-foreground">
            <span>
              {t("pages.feedback.pagination.summary", {
                from: rows.length ? (page - 1) * pageSize + 1 : 0,
                to: rows.length ? (page - 1) * pageSize + rows.length : 0,
                total,
              })}
            </span>
            <div className="flex items-center gap-2">
              <span>
                {t("pages.feedback.pagination.page", { page, pages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {t("pages.feedback.pagination.previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || Boolean(error) || page >= pages}
                onClick={() => setPage((value) => value + 1)}
              >
                {t("pages.feedback.pagination.next")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        {selectedId && (
          <DialogContent
            className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
            closeLabel={t("common.close")}
          >
            <DialogHeader>
              <DialogTitle>{t("pages.feedback.detail")}</DialogTitle>
            </DialogHeader>
            <FeedbackDetails
              key={selectedId}
              id={selectedId}
              onUpdated={() => setRevision((value) => value + 1)}
            />
          </DialogContent>
        )}
      </Dialog>
      {accountUserID && (
        <AccountDialog
          key={accountUserID}
          userId={accountUserID}
          onClose={() => setAccountUserID(null)}
        />
      )}
    </section>
  )
}
