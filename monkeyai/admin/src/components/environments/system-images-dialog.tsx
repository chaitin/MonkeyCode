import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { Trans, useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import {
  ArrowDownToLine,
  Box,
  FileArchive,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { systemImages, type SystemImage } from "@/lib/system-images"
import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Field, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"

type ImportMethod = "pull" | "upload"
const invalidReference = (value: string) =>
  !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(value) || value.includes("://")

export function SystemImagesDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const text = (key: string) => t("environmentAdmin.systemImages." + key)
  const [images, setImages] = useState<SystemImage[]>([])
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [adding, setAdding] = useState<ImportMethod | null>(null)
  const [renaming, setRenaming] = useState<{
    image: SystemImage
    name: string
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SystemImage | null>(null)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    systemImages
      .list()
      .then((items) => {
        if (active) {
          setImages(items)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) {
          setError(t("environmentAdmin.systemImages.loadFailed"))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [revision, t])

  const importing = images.some(
    (item) => item.status === "pending" || item.status === "importing"
  )
  useEffect(() => {
    if (!importing) return
    const controller = new AbortController()
    let timer: number
    async function poll() {
      let delay = 1000
      try {
        const items = await systemImages.list(controller.signal)
        if (!controller.signal.aborted) setImages(items)
      } catch {
        delay = 4000
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, delay)
    }
    timer = window.setTimeout(poll, 1000)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [importing])

  function requestDelete(image: SystemImage) {
    setError("")
    setDeleteTarget(image)
    setConfirmationOpen(true)
  }

  async function saveDisplayName(event: FormEvent) {
    event.preventDefault()
    if (!renaming?.name.trim() || busy) return
    setBusy(true)
    try {
      const updated = await systemImages.rename(
        renaming.image.id,
        renaming.name
      )
      setImages((items) =>
        items.map((item) => (item.id === updated.id ? updated : item))
      )
      setRenaming(null)
      showToast({ status: "success", title: text("renamed") })
    } catch {
      showToast({ status: "error", title: text("operationFailed") })
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(event: FormEvent) {
    event.preventDefault()
    if (!confirmationOpen || !deleteTarget || busy) return
    setBusy(true)
    setError("")
    try {
      await systemImages.remove(deleteTarget.id)
      setImages((items) => items.filter((item) => item.id !== deleteTarget.id))
      setConfirmationOpen(false)
      showToast({
        status: "success",
        title: text("deleted"),
      })
    } catch {
      setError(text("operationFailed"))
      showToast({ status: "error", title: text("operationFailed") })
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[88dvh] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-2xl"
        closeLabel={t("environmentAdmin.close")}
      >
        <DialogHeader>
          <DialogTitle>{text("title")}</DialogTitle>
          <DialogDescription>{text("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          {error && !deleteTarget && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <ScrollArea
            horizontal
            className="min-h-0 min-w-0 flex-1 rounded-lg border [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">{text("imageName")}</TableHead>
                  <TableHead>{text("addedAt")}</TableHead>
                  <TableHead className="pe-4 text-end">
                    {t("environmentAdmin.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="h-40 text-center text-muted-foreground"
                    >
                      {text("loading")}
                    </TableCell>
                  </TableRow>
                ) : images.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-40 text-center">
                      <Box className="mx-auto mb-3 size-7 text-muted-foreground" />
                      <p className="font-medium">{text("empty")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {text("emptyHint")}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  images.map((image) => (
                    <TableRow key={image.id}>
                      <TableCell className="ps-4">
                        <span
                          className="block max-w-72 truncate text-sm font-medium"
                          title={image.display_name}
                        >
                          {image.display_name}
                        </span>
                        {image.status === "ready" && (
                          <span className="text-xs text-muted-foreground">
                            {text(image.is_default ? "defaultImage" : "stored")}
                          </span>
                        )}
                        {image.status === "failed" && (
                          <span role="alert">
                            {image.error?.message || text("operationFailed")}
                          </span>
                        )}
                        {(image.status === "importing" ||
                          image.status === "pending") && (
                          <ImageProgress
                            stage={image.progress.stage}
                            value={
                              image.progress.total_bytes
                                ? Math.floor(
                                    (100 * image.progress.completed_bytes) /
                                      image.progress.total_bytes
                                  )
                                : null
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(image.added_at).toLocaleString(
                          i18n.resolvedLanguage ?? i18n.language,
                          {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </TableCell>
                      <TableCell className="pe-4 text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={busy}
                            aria-label={
                              t("common.more") + " · " + image.display_name
                            }
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                              />
                            }
                          >
                            <HugeiconsIcon
                              icon={MoreHorizontalIcon}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={() =>
                                  setRenaming({
                                    image,
                                    name: image.display_name,
                                  })
                                }
                              >
                                <Pencil aria-hidden="true" />
                                {text("rename")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={
                                  image.is_default ||
                                  image.status === "importing" ||
                                  image.status === "pending"
                                }
                                onClick={() => requestDelete(image)}
                              >
                                <Trash2 aria-hidden="true" />
                                {text("delete")}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between sm:justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" disabled={busy} />}
            >
              {text("add")}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-40">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setAdding("pull")
                    setError("")
                  }}
                >
                  <ArrowDownToLine className="size-4" aria-hidden="true" />
                  {text("pullTab")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAdding("upload")
                    setError("")
                  }}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  {text("uploadTab")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ms-auto flex items-center gap-2">
            <Button
              variant="outline"
              disabled={loading || busy}
              onClick={() => {
                setLoading(true)
                setError("")
                setRevision((value) => value + 1)
              }}
            >
              {text("refresh")}
            </Button>
            <Button disabled={busy} onClick={onClose}>
              {t("environmentAdmin.close")}
            </Button>
          </div>
        </DialogFooter>
        {renaming && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !busy) setRenaming(null)
            }}
          >
            <DialogContent
              closeLabel={t("environmentAdmin.close")}
              showCloseButton={!busy}
            >
              <DialogHeader>
                <DialogTitle>{text("rename")}</DialogTitle>
              </DialogHeader>
              <form className="space-y-5" onSubmit={saveDisplayName}>
                <DisplayNameField
                  value={renaming.name}
                  onChange={(name) => setRenaming({ ...renaming, name })}
                  disabled={busy}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRenaming(null)}
                  >
                    {t("environmentAdmin.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={
                      !renaming.name.trim() ||
                      renaming.name.trim() === renaming.image.display_name
                    }
                  >
                    {t("environmentAdmin.save")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {adding && (
          <AddImageDialog
            key={adding}
            method={adding}
            images={images}
            onClose={() => setAdding(null)}
            onAdded={(item) => {
              setImages((items) => [
                item,
                ...items.filter((i) => i.id !== item.id),
              ])
              setAdding(null)
              showToast({
                status: "success",
                title: text("accepted"),
              })
            }}
          />
        )}
        <AlertDialog
          open={confirmationOpen}
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmationOpen(false)
          }}
          onOpenChangeComplete={(open) => {
            if (!open) {
              setDeleteTarget(null)
              setBusy(false)
              setError("")
            }
          }}
        >
          <AlertDialogContent>
            <form onSubmit={confirmDelete} className="space-y-5">
              <AlertDialogHeader>
                <AlertDialogTitle>{text("deleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans
                    i18nKey="environmentAdmin.systemImages.deleteHint"
                    components={{
                      imageName: (
                        <strong className="break-all">
                          {deleteTarget?.display_name}
                        </strong>
                      ),
                    }}
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>
                  {t("environmentAdmin.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  type="submit"
                  variant="destructive"
                  loading={busy}
                >
                  {text(busy ? "deleting" : "confirmDelete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

function ImageProgress({
  stage,
  value,
}: {
  stage: string
  value: number | null
}) {
  const { t } = useTranslation()
  const label = t("environmentAdmin.systemImages.stages." + stage)
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <span>
        {label}
        {value !== null && ` · ${value}%`}
      </span>
      <Progress value={value} aria-label={label} />
    </div>
  )
}

function DisplayNameField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const id = useId()
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {t("environmentAdmin.systemImages.imageName")}
      </FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={t("environmentAdmin.systemImages.imageNameExample")}
        required
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function AddImageDialog({
  method,
  images,
  onAdded,
  onClose,
}: {
  method: ImportMethod
  images: SystemImage[]
  onAdded: (image: SystemImage) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const text = (key: string) => t("environmentAdmin.systemImages." + key)
  const [upstream, setUpstream] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const [sent, setSent] = useState<number | null>(null)
  const request = useRef<{
    name: string
    source: string
    file: File | null
    key: string
  } | null>(null)

  function selectFile(files: File[]) {
    setError("")
    if (
      files.length !== 1 ||
      !/\.(tar|tgz|tar\.gz)$/i.test(files[0]?.name ?? "")
    ) {
      setError(text("invalidArchive"))
      return
    }
    if (files[0].size === 0) {
      setError(text("emptyArchive"))
      return
    }
    setFile(files[0])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !displayName.trim()) return
    const source = upstream.trim()
    if (method === "pull" && invalidReference(source)) {
      setError(text("invalidReference"))
      return
    }
    if (method === "upload" && !file) {
      setError(text("fileRequired"))
      return
    }
    if (
      method === "pull" &&
      images.some(
        (image) => image.status !== "failed" && image.upstream === source
      )
    ) {
      setError(text("duplicate"))
      return
    }
    setError("")
    setBusy(true)
    try {
      if (
        !request.current ||
        request.current.name !== displayName ||
        request.current.source !== source ||
        request.current.file !== file
      )
        request.current = {
          name: displayName,
          source,
          file,
          key: crypto.randomUUID(),
        }
      setSent(null)
      onAdded(
        method === "pull"
          ? await systemImages.pull(displayName, source, request.current.key)
          : await systemImages.upload(
              displayName,
              file!,
              request.current.key,
              setSent
            )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : text("operationFailed"))
      showToast({ status: "error", title: text("operationFailed") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl"
        closeLabel={t("environmentAdmin.close")}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {text(method === "pull" ? "pullTab" : "uploadTab")}
          </DialogTitle>
          <DialogDescription>
            {text(method === "pull" ? "pullDescription" : "uploadDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-5">
          {method === "pull" && (
            <Field>
              <FieldLabel htmlFor="image-upstream">
                {text("upstream")}
              </FieldLabel>
              <Input
                id="image-upstream"
                required
                value={upstream}
                disabled={busy}
                placeholder="library/ubuntu:24.04"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => {
                  setUpstream(event.target.value)
                  setError("")
                }}
              />
              {busy && <Progress value={null} aria-label={text("pulling")} />}
            </Field>
          )}
          <DisplayNameField
            value={displayName}
            onChange={setDisplayName}
            disabled={busy}
          />
          {method === "upload" && (
            <ScrollArea className="-me-6 min-h-0 flex-1">
              <div className="space-y-5 pe-6">
                <Field>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".tar,.tgz,.tar.gz"
                    className="sr-only"
                    aria-label={text("chooseFile")}
                    disabled={busy}
                    onChange={(event) => {
                      if (event.target.files?.length)
                        selectFile(Array.from(event.target.files))
                      event.target.value = ""
                    }}
                  />
                  <div className="relative min-w-0">
                    <button
                      type="button"
                      disabled={busy}
                      className={`flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${dragging ? "border-muted-foreground/50 bg-muted/60" : "border-muted-foreground/25 bg-muted/20 enabled:hover:border-muted-foreground/50 enabled:hover:bg-muted/60"}`}
                      onClick={() => inputRef.current?.click()}
                      onDragOver={(event) => {
                        event.preventDefault()
                        if (!busy) setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        if (!busy)
                          selectFile(Array.from(event.dataTransfer.files))
                      }}
                    >
                      {file ? (
                        <FileArchive className="size-7 text-muted-foreground" />
                      ) : (
                        <Upload className="size-7 text-muted-foreground" />
                      )}
                      <span
                        className="max-w-full truncate text-sm font-medium"
                        title={file?.name}
                      >
                        {file?.name ?? text("dropFile")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {file
                          ? `${(file.size / 1024 ** 2).toFixed(2)} MB`
                          : ".tar / .tgz / .tar.gz"}
                      </span>
                    </button>
                    {file && (
                      <Button
                        className="absolute end-2 top-2"
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={text("removeFile")}
                        disabled={busy}
                        onClick={() => {
                          setFile(null)
                          setError("")
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
            </ScrollArea>
          )}
          {busy && method === "upload" && (
            <ImageProgress
              value={sent}
              stage={sent === 100 ? "awaiting" : "uploading"}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {t("environmentAdmin.cancel")}
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={
                !displayName.trim() ||
                (method === "upload" ? !file : !upstream.trim())
              }
            >
              {text(
                method === "upload"
                  ? busy
                    ? "importing"
                    : "startImport"
                  : busy
                    ? "pulling"
                    : "startPull"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
