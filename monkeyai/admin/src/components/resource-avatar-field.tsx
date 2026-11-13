import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ImageUploadIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type ResourceAvatarDraft = { file: File; previewURL: string } | null

export function ResourceAvatarField({
  id,
  label,
  uploadLabel,
  replaceLabel,
  fallback,
  acceptedTypes = ["image/png", "image/jpeg", "image/webp"],
  invalidImageMessage,
  src,
  value,
  onValueChange,
  disabled,
  loading,
}: {
  id: string
  label?: string
  uploadLabel?: string
  replaceLabel?: string
  fallback: ReactNode
  acceptedTypes?: string[]
  invalidImageMessage?: string
  src: string
  value: ResourceAvatarDraft
  onValueChange: (value: ResourceAvatarDraft) => void
  disabled: boolean
  loading: boolean
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const squarePreviewRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return
    const grid = node.closest<HTMLElement>("[data-resource-basics]")
    const updateSize = () => {
      const height = getComputedStyle(node).height
      if (
        height !== "0px" &&
        grid?.style.getPropertyValue("--resource-avatar-size") !== height
      ) {
        grid?.style.setProperty("--resource-avatar-size", height)
      }
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(
    () => () => {
      if (value) URL.revokeObjectURL(value.previewURL)
    },
    [value]
  )
  const imageURL = value?.previewURL || src
  return (
    <Field className="contents">
      <FieldLabel htmlFor={`${id}-upload`} className="col-start-2 row-start-1">
        {label ?? t("pages.experts.avatar")}
      </FieldLabel>
      <Button
        ref={squarePreviewRef}
        id={`${id}-upload`}
        type="button"
        variant="ghost"
        className="group relative col-start-2 row-span-3 row-start-2 size-full min-h-0 cursor-pointer rounded-md border-input p-1"
        disabled={disabled}
        aria-busy={loading}
        aria-label={
          imageURL
            ? (replaceLabel ?? t("pages.experts.replaceAvatar"))
            : (uploadLabel ?? t("pages.experts.uploadAvatar"))
        }
        onClick={() => input.current?.click()}
      >
        <Avatar className="size-full rounded-md after:rounded-md after:border-0">
          {imageURL && (
            <AvatarImage
              src={imageURL}
              alt=""
              className="aspect-auto size-full rounded-md object-contain"
            />
          )}
          <AvatarFallback className="rounded-md">{fallback}</AvatarFallback>
        </Avatar>
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none",
            loading && "opacity-100"
          )}
        >
          <HugeiconsIcon
            icon={loading ? Loading03Icon : ImageUploadIcon}
            className={cn(
              "size-6",
              loading && "animate-spin motion-reduce:animate-none"
            )}
            strokeWidth={2}
          />
        </span>
      </Button>
      <Input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept={acceptedTypes.join(",")}
        className="hidden"
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          setError("")
          if (file.size > 1024 * 1024) {
            setError(t("pages.experts.avatarTooLarge"))
            return
          }
          if (!acceptedTypes.includes(file.type)) {
            setError(invalidImageMessage ?? t("pages.experts.avatarInvalid"))
            return
          }
          onValueChange({ file, previewURL: URL.createObjectURL(file) })
        }}
      />
      {error && (
        <p
          role="alert"
          className="col-start-2 row-start-5 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </Field>
  )
}
