import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { ImageUploadIcon, Loading03Icon } from "@hugeicons/core-free-icons"

import { useAppToast } from "@/components/animated-toast-provider"
import { uploadAvatar, type AvatarUpdate } from "@/lib/profile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"

export function AvatarPickerDialog({
  avatar,
  csrfToken,
  onSelect,
  onClose,
  returnFocusRef,
}: {
  avatar: string
  csrfToken: string
  onSelect: (result: AvatarUpdate) => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const id = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState(avatar)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<"invalidImage" | "imageTooLarge" | "">("")

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!file) return
    const reader = new FileReader()
    const image = new Image()
    let cancelled = false
    const fail = () => {
      if (cancelled) return
      setError("invalidImage")
      setReading(false)
    }
    reader.onerror = fail
    reader.onload = () => {
      if (cancelled) return
      const dataURL = reader.result
      if (typeof dataURL !== "string") {
        fail()
        return
      }
      image.onload = () => {
        if (cancelled) return
        setPreview(dataURL)
        setReading(false)
      }
      image.onerror = fail
      image.src = dataURL
    }
    reader.readAsDataURL(file)
    return () => {
      cancelled = true
      reader.onload = null
      reader.onerror = null
      image.onload = null
      image.onerror = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
    }
  }, [file])

  function selectFile(selected?: File) {
    if (!selected) return
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(selected.type) ||
      selected.size === 0
    ) {
      setError("invalidImage")
      return
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError("imageTooLarge")
      return
    }
    setError("")
    setReading(true)
    setFile(selected)
  }

  async function saveAvatar() {
    if (!file || reading || saving || error) return
    setSaving(true)
    try {
      const result = await uploadAvatar(file, csrfToken)
      if (!mounted.current) return
      onSelect(result)
      onClose()
    } catch (reason) {
      if (!mounted.current) return
      showToast({
        status: "error",
        title:
          reason instanceof Error
            ? reason.message
            : t("accountSettings.profileLoadFailed"),
      })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md"
        closeLabel={t("common.close")}
        showCloseButton={!saving}
        finalFocus={returnFocusRef}
      >
        <DialogHeader className="shrink-0 pe-8">
          <DialogTitle>{t("accountSettings.changeAvatar")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="-me-3 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
          <div className="space-y-5 pe-3">
            <button
              type="button"
              className="relative block w-full cursor-pointer rounded-lg border border-dashed bg-muted/20 text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
              disabled={reading || saving}
              aria-busy={reading}
              onClick={() => fileInputRef.current?.click()}
              aria-describedby={error ? `${id}-error` : undefined}
            >
              <span aria-hidden="true" className="block pb-[100%]" />
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
                {file && !reading && !error && preview !== avatar ? (
                  <img
                    src={preview}
                    alt=""
                    className="min-h-0 w-full flex-1 rounded-md object-contain"
                  />
                ) : (
                  <HugeiconsIcon
                    icon={reading ? Loading03Icon : ImageUploadIcon}
                    strokeWidth={1.5}
                    className={
                      reading
                        ? "size-8 animate-spin motion-reduce:animate-none"
                        : "size-8"
                    }
                    aria-hidden="true"
                  />
                )}
                <span className="shrink-0 text-sm font-medium">
                  {t("accountSettings.chooseFile")}
                </span>
              </span>
            </button>
            <Input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0]
                event.currentTarget.value = ""
                selectFile(selected)
              }}
            />
            {error && (
              <FieldError id={`${id}-error`}>
                {t(`accountSettings.${error}`)}
              </FieldError>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            {t("accountSettings.cancel")}
          </Button>
          <Button
            type="button"
            loading={saving}
            disabled={
              reading || saving || Boolean(error) || !file || preview === avatar
            }
            onClick={() => void saveAvatar()}
          >
            {t("accountSettings.useAvatar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
