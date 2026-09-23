import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type Option = {
  qualities: string[]
  aspect_ratios: string[]
  default_quality: string
  default_aspect_ratio: string
}

type Capability = {
  operations: string[]
  max_images: number
  max_reference_images: number
  supports_reference_image: boolean
  allowed_aspect_ratios?: Record<string, string[]>
  supports_mask: boolean
}

type Task = {
  id: string
  status: string
  outputs?: Array<{ url: string; mime_type: string }>
  usage?: { credits?: string; generated_images: number }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: string
  upstreamModel: string
  provider: string
  options: Option
}

async function withKey<T>(
  path: string,
  key: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "omit",
    headers: {
      "X-Api-Key": key,
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function ImageGenerationTest({
  open,
  onOpenChange,
  model,
  upstreamModel,
  provider,
  options,
}: Props) {
  const { t } = useTranslation()
  const [key, setKey] = useState("")
  const [capability, setCapability] = useState<Capability | null>(null)
  const [operation, setOperation] = useState<"generate" | "edit">("generate")
  const [prompt, setPrompt] = useState("")
  const [quality, setQuality] = useState(options.default_quality)
  const [aspect, setAspect] = useState(options.default_aspect_ratio)
  const [count, setCount] = useState(1)
  const [references, setReferences] = useState<File[]>([])
  const [mask, setMask] = useState<File | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    api<Capability>(
      `/api/admin/v1/models/image-capabilities?provider=${encodeURIComponent(provider)}&model_id=${encodeURIComponent(upstreamModel)}`
    )
      .then((result) => {
        if (active) setCapability(result)
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [open, provider, upstreamModel])

  useEffect(() => {
    if (
      !open ||
      !task?.id ||
      ["succeeded", "failed", "expired"].includes(task.status)
    )
      return
    let active = true
    const timer = window.setInterval(() => {
      withKey<Task>(`/v1/images/tasks/${encodeURIComponent(task.id)}`, key)
        .then((result) => {
          if (active) setTask(result)
        })
        .catch((reason: Error) => {
          if (active) setError(reason.message)
        })
    }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [open, task?.id, task?.status, key])

  useEffect(() => {
    if (!open || !task || task.status !== "succeeded" || !task.outputs?.length)
      return
    let active = true
    const urls: string[] = []
    Promise.all(
      task.outputs.map(async (output) => {
        const response = await fetch(output.url, {
          credentials: "omit",
          headers: { "X-Api-Key": key },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const objectURL = URL.createObjectURL(await response.blob())
        urls.push(objectURL)
        return objectURL
      })
    )
      .then((result) => {
        if (active) setImages(result)
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
      urls.forEach(URL.revokeObjectURL)
    }
  }, [open, task, key])

  const availableRatios = options.aspect_ratios.filter(
    (ratio) =>
      !capability?.allowed_aspect_ratios ||
      capability.allowed_aspect_ratios[quality]?.includes(ratio)
  )
  const operationItems = [
    { value: "generate", label: t("pages.models.generate") },
    { value: "edit", label: t("pages.models.edit") },
  ]
  const qualityItems = options.qualities.map((value) => ({
    value,
    label: value,
  }))
  const aspectItems = availableRatios.map((value) => ({ value, label: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      !capability ||
      !key ||
      !prompt.trim() ||
      !availableRatios.includes(aspect)
    )
      return
    if (operation === "edit" && references.length === 0) return
    setBusy(true)
    setError("")
    setTask(null)
    setImages([])
    try {
      const upload = async (file: File) => {
        const body = new FormData()
        body.append("file", file)
        return withKey<{ file_id: string }>("/v1/images/inputs", key, {
          method: "POST",
          body,
        })
      }
      const input = await Promise.all(references.map(upload))
      const maskInput = mask && operation === "edit" ? await upload(mask) : null
      const body = {
        model,
        prompt: prompt.trim(),
        quality,
        aspect_ratio: aspect,
        count,
        ...(operation === "edit"
          ? { images: input, ...(maskInput ? { mask: maskInput } : {}) }
          : { reference_images: input }),
      }
      const path =
        operation === "edit" ? "/v1/images/edits" : "/v1/images/generations"
      setTask(
        await withKey<Task>(path, key, {
          method: "POST",
          body: JSON.stringify(body),
        })
      )
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("pages.models.testGeneration")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("pages.models.testGenerationWarning")}
        </p>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="image-test-key">
                {t("pages.models.invocationKey")}
              </FieldLabel>
              <Input
                id="image-test-key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
              />
            </Field>
            {capability?.operations.includes("edit") && (
              <Field>
                <FieldLabel htmlFor="image-test-operation">
                  {t("pages.models.imageOperation")}
                </FieldLabel>
                <Select
                  items={operationItems}
                  value={operation}
                  onValueChange={(value) => {
                    if (value !== null)
                      setOperation(value as "generate" | "edit")
                  }}
                >
                  <SelectTrigger id="image-test-operation" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    <SelectGroup>
                      {operationItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="image-test-prompt">
                {t("pages.models.prompt")}
              </FieldLabel>
              <Textarea
                id="image-test-prompt"
                className="min-h-20"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="image-test-quality">
                  {t("pages.models.imageQuality")}
                </FieldLabel>
                <Select
                  items={qualityItems}
                  value={quality}
                  onValueChange={(value) => {
                    if (value === null) return
                    setQuality(value)
                    setAspect("")
                  }}
                >
                  <SelectTrigger id="image-test-quality" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    <SelectGroup>
                      {qualityItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="image-test-aspect">
                  {t("pages.models.aspectRatio")}
                </FieldLabel>
                <Select
                  items={aspectItems}
                  value={aspect || null}
                  onValueChange={(value) => {
                    if (value !== null) setAspect(value)
                  }}
                >
                  <SelectTrigger id="image-test-aspect" className="w-full">
                    <SelectValue placeholder={t("pages.models.selectAspect")} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    <SelectGroup>
                      {aspectItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="image-test-count">
                {t("pages.models.imageCount")}
              </FieldLabel>
              <Input
                id="image-test-count"
                type="number"
                min={1}
                max={capability?.max_images ?? 1}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                required
              />
            </Field>
            {(operation === "edit" || capability?.supports_reference_image) && (
              <Field>
                <FieldLabel htmlFor="image-test-references">
                  {t("pages.models.referenceImages")}
                </FieldLabel>
                <Input
                  id="image-test-references"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) =>
                    setReferences(Array.from(event.target.files ?? []))
                  }
                  required={operation === "edit"}
                />
              </Field>
            )}
            {operation === "edit" && capability?.supports_mask && (
              <Field>
                <FieldLabel htmlFor="image-test-mask">
                  {t("pages.models.mask")}
                </FieldLabel>
                <Input
                  id="image-test-mask"
                  type="file"
                  accept="image/png"
                  onChange={(event) => setMask(event.target.files?.[0] ?? null)}
                />
              </Field>
            )}
          </FieldGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {task && (
            <p className="text-sm">
              {t("pages.models.taskStatus")}: {task.status}
              {task.usage?.credits ? ` · ${task.usage.credits}` : ""}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {images.map((src) => (
              <img
                className="w-full rounded-md"
                key={src}
                src={src}
                alt={prompt}
              />
            ))}
          </div>
          <Button
            type="submit"
            disabled={
              busy ||
              !capability ||
              !availableRatios.includes(aspect) ||
              count < 1 ||
              count > capability.max_images ||
              references.length > capability.max_reference_images
            }
          >
            {t("pages.models.testGeneration")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
