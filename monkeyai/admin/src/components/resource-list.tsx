import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import {
  type useResourceList,
  type ResourceType,
} from "@/hooks/use-resource-list"
import { ResourceNotice } from "@/components/resource-notice"
import { PageSizeSelect } from "@/components/page-size-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type Props = {
  page: Omit<ReturnType<typeof useResourceList<unknown>>, "run">
  typeLabel: string
  systemLabel: string
  userLabel: string
  searchPlaceholder?: string
  error?: string
  pending?: boolean
  actions?: ReactNode
  children: ReactNode
}

export function ResourceList({
  page,
  typeLabel,
  systemLabel,
  userLabel,
  searchPlaceholder,
  error = "",
  pending = false,
  actions,
  children,
}: Props) {
  const { t } = useTranslation()
  const busy = page.pending || pending
  const placeholder = searchPlaceholder ?? t("resources.ruleSearchPlaceholder")
  return (
    <>
      <Tabs
        className="-m-1 min-h-0 flex-1 gap-4 overflow-hidden p-1"
        value={page.type}
        onValueChange={(value) => page.setType(value as ResourceType)}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <TabsList className="shrink-0" aria-label={typeLabel}>
            <TabsTrigger value="system" disabled={busy}>
              {systemLabel}
            </TabsTrigger>
            <TabsTrigger value="user" disabled={busy}>
              {userLabel}
            </TabsTrigger>
          </TabsList>
          <form
            className="order-2 flex basis-full items-center gap-2 sm:order-none sm:max-w-72 sm:min-w-40 sm:flex-1 sm:basis-0"
            onSubmit={page.handleSearch}
          >
            <Input
              type="search"
              value={page.searchDraft}
              onChange={(event) => page.setSearchDraft(event.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              disabled={busy}
            />
          </form>
          {page.type === "system" && actions}
        </div>
        <TabsContent
          key={page.type}
          value={page.type}
          className="min-h-0 overflow-hidden"
        >
          <ScrollArea
            key={`${page.search}:${page.page}:${page.pageSize}`}
            className="h-full"
          >
            <div className="flex flex-col gap-4 p-px">
              <ResourceNotice
                error={page.error || error}
                loading={page.loading}
                pending={busy}
              />
              {page.error && (
                <Button
                  className="self-start"
                  type="button"
                  variant="outline"
                  onClick={page.reload}
                >
                  {t("statistics.retry")}
                </Button>
              )}
              {!page.loading && !page.error && page.items.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {t("statistics.empty")}
                </p>
              )}
              {children}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <PageSizeSelect
          value={page.pageSize}
          onValueChange={page.setPageSize}
          disabled={busy}
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t("pages.sessionReporting.clients.cursorPage", {
              page: page.page,
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={page.loading || busy || page.page === 1}
            onClick={() => page.previousPage()}
            aria-label={t("pages.operationLogs.pagination.previous")}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="[[dir=rtl]_&]:rotate-180" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={page.loading || busy || !page.nextCursor}
            onClick={page.nextPage}
            aria-label={t("pages.operationLogs.pagination.next")}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="[[dir=rtl]_&]:rotate-180" />
          </Button>
        </div>
      </div>
    </>
  )
}
