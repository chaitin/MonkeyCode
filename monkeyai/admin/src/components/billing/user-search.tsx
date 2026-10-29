import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Cancel01Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UserAvatar } from "@/components/user-avatar"
import { api } from "@/lib/api"

type User = {
  id: string
  name: string
  email: string
  avatar_url?: string | null
  deleted: boolean
}
type Result = { items: User[]; has_next: boolean }

export function BillingUserSearch({
  userID,
  query,
  onChange,
}: {
  userID: string
  query: string
  onChange: (value: { userID: string; query: string }) => void
}) {
  const { t } = useTranslation()
  const hintID = useId()
  const anchor = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [retry, setRetry] = useState(0)
  const [resolved, setResolved] = useState<User | null>(null)
  const [result, setResult] = useState<
    (Result & { key: string; error?: string }) | null
  >(null)
  const term = userID ? "" : query.trim()
  const requestKey = JSON.stringify([term, generation, retry])
  const selected = useMemo(
    () =>
      resolved?.id === userID
        ? resolved
        : userID
          ? { id: userID, name: userID, email: "", deleted: false }
          : null,
    [resolved, userID]
  )

  useEffect(() => {
    if (!userID || resolved?.id === userID) return
    const controller = new AbortController()
    void api<Result>(
      `/api/admin/v1/billing/users?id=${encodeURIComponent(userID)}`,
      { signal: controller.signal }
    )
      .then((data) => {
        if (!controller.signal.aborted && data.items[0])
          setResolved(data.items[0])
      })
      .catch(() => {
        /* The UUID remains usable if its display lookup fails. */
      })
    return () => controller.abort()
  }, [userID, resolved?.id])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<Result>(
        `/api/admin/v1/billing/users?q=${encodeURIComponent(term)}&limit=20`,
        { signal: controller.signal }
      )
        .then((data) => {
          if (!controller.signal.aborted)
            setResult({ ...data, key: requestKey })
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted)
            setResult({
              key: requestKey,
              items: [],
              has_next: false,
              error: error.message,
            })
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, term, requestKey])

  const current = result?.key === requestKey ? result : null
  const items = selected
    ? [
        selected,
        ...(current?.items ?? []).filter((user) => user.id !== selected.id),
      ]
    : (current?.items ?? [])
  return (
    <Combobox.Root<User>
      items={items}
      filter={null}
      autoHighlight={false}
      openOnInputClick
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setGeneration((value) => value + 1)
      }}
      value={selected}
      inputValue={
        selected ? selected.name || selected.email || selected.id : query
      }
      itemToStringLabel={(user) => user.name || user.email || user.id}
      isItemEqualToValue={(a, b) => a.id === b.id}
      onInputValueChange={(value, details) => {
        if (
          details.reason === "input-change" ||
          details.reason === "input-clear" ||
          details.reason === "clear-press"
        )
          onChange({ userID: "", query: value })
      }}
      onValueChange={(user, details) => {
        if (user && details.reason === "item-press") {
          setResolved(user)
          onChange({ userID: user.id, query: "" })
        } else if (!user && details.reason === "clear-press")
          onChange({ userID: "", query: "" })
      }}
    >
      <div className="relative w-32">
        <Combobox.Input
          ref={anchor}
          render={<Input id="billing-user" className="w-32 pe-7" />}
          placeholder={t("pages.billingDetails.filters.userPlaceholder")}
          aria-label={t("pages.billingDetails.filters.userPlaceholder")}
          aria-describedby={open ? hintID : undefined}
          title={
            selected
              ? `${selected.name} ${selected.email} ${selected.id}`
              : undefined
          }
          onKeyDownCapture={(event) => {
            if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing &&
              !event.currentTarget.getAttribute("aria-activedescendant")
            ) {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              event.currentTarget.closest("form")?.requestSubmit()
            }
          }}
        />
        {(userID || query) && (
          <Combobox.Clear
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute end-1 top-1 size-7"
                aria-label={t("pages.billingDetails.filters.clearUser")}
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
          </Combobox.Clear>
        )}
      </div>
      <Combobox.Portal>
        <Combobox.Positioner
          anchor={anchor}
          align="start"
          sideOffset={4}
          className="z-50"
        >
          <Combobox.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
            {!current ? (
              <div
                role="status"
                aria-label={t("resources.tableLoading")}
                className="flex h-10 items-center justify-center"
              >
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              </div>
            ) : current.error ? (
              <div role="alert" className="p-2 text-sm text-destructive">
                {current.error}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  {t("statistics.retry")}
                </Button>
              </div>
            ) : null}
            <Combobox.List className="max-h-64 overflow-y-auto p-1 empty:hidden">
              {(user: User) => (
                <Combobox.Item
                  key={user.id}
                  value={user}
                  className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none"
                  title={`${user.name} ${user.email} ${user.id}`}
                >
                  <UserAvatar
                    src={user.avatar_url}
                    className="data-[size=sm]:size-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {user.name || user.email || user.id}
                      {user.deleted
                        ? ` · ${t("pages.billingDetails.filters.deletedUser")}`
                        : ""}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user.email || user.id}
                    </span>
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
            {current && !current.error && items.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">
                {t("pages.billingDetails.filters.usersEmpty")}
              </p>
            )}
            <div
              id={hintID}
              className="border-t p-2 text-xs text-muted-foreground"
            >
              {current?.has_next
                ? `${t("pages.billingDetails.filters.usersMore")} `
                : ""}
              {t("pages.billingDetails.filters.userHint")}
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
