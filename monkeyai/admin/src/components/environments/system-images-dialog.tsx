import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import {
  ArrowDownToLine,
  Box,
  FileArchive,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import {
  systemImagesPreview,
  type SystemImage,
} from "@/lib/system-images-preview"
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
type Confirmation = { kind: "delete" | "update"; image: SystemImage }
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    systemImagesPreview
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

  function request(kind: Confirmation["kind"], image: SystemImage) {
    setError("")
    setConfirmation({ kind, image })
    setConfirmationOpen(true)
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (!confirmationOpen || !confirmation || busy) return
    setBusy(true)
    setError("")
    const { kind, image } = confirmation
    try {
      const items =
        kind === "delete"
          ? await systemImagesPreview.remove(image.id)
          : await systemImagesPreview.repull(image.id)
      setImages(items)
      setConfirmationOpen(false)
      showToast({
        status: "success",
        title: text(kind === "delete" ? "deleted" : "updated"),
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
          {error && !confirmation && (
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
                  <TableHead className="ps-4">{text("reference")}</TableHead>
                  <TableHead>{text("updatedAt")}</TableHead>
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
                          className="block max-w-72 truncate font-mono text-sm font-medium"
                          title={image.reference}
                        >
                          {image.reference}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(image.updatedAt).toLocaleString(
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
                              t("common.more") + " · " + image.reference
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
                                onClick={() => request("update", image)}
                              >
                                <RefreshCw aria-hidden="true" />
                                {text("update")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => request("delete", image)}
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
        {adding && (
          <AddImageDialog
            key={adding}
            method={adding}
            images={images}
            onClose={() => setAdding(null)}
            onAdded={(items) => {
              setImages(items)
              setAdding(null)
              showToast({
                status: "success",
                title: text(adding === "pull" ? "pulled" : "added"),
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
              setConfirmation(null)
              setBusy(false)
              setError("")
            }
          }}
        >
          <AlertDialogContent>
            <form onSubmit={confirm} className="space-y-5">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {text(
                    confirmation?.kind === "delete"
                      ? "deleteTitle"
                      : "updateTitle"
                  )}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {text(
                    confirmation?.kind === "delete"
                      ? "deleteHint"
                      : "updateHint"
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <p className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs">
                {confirmation?.image.reference}
              </p>
              {confirmation?.kind === "update" && busy && (
                <Progress value={null} aria-label={text("pulling")} />
              )}
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
                  variant={
                    confirmation?.kind === "delete" ? "destructive" : "default"
                  }
                  loading={busy}
                >
                  {text(
                    busy
                      ? confirmation?.kind === "delete"
                        ? "deleting"
                        : "updating"
                      : confirmation?.kind === "delete"
                        ? "confirmDelete"
                        : "confirmUpdate"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
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
  onAdded: (images: SystemImage[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const text = (key: string) => t("environmentAdmin.systemImages." + key)
  const [upstream, setUpstream] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (busy) return
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
      images.some((image) => image.reference === source)
    ) {
      setError(text("duplicate"))
      return
    }
    setError("")
    setBusy(true)
    try {
      onAdded(
        await systemImagesPreview.add(
          method === "pull"
            ? { source: "pull", reference: source, upstream: source }
            : { source: "upload", reference: file!.name, file: file! }
        )
      )
    } catch {
      setError(text("operationFailed"))
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
          {method === "pull" ? (
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
          ) : (
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
            <Progress value={null} aria-label={text("importing")} />
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
              disabled={method === "upload" ? !file : !upstream.trim()}
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
