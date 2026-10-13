import { useId, useRef } from "react"

import { Button } from "@/components/ui/button"

type FileInputProps = {
  accept?: string
  chooseLabel: string
  file: File | null
  onChange: (file: File | null) => void
}

export function FileInput({
  accept,
  chooseLabel,
  file,
  onChange,
}: FileInputProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
      >
        {chooseLabel}
      </Button>
      <span className="min-w-0 truncate text-sm text-muted-foreground">
        {file?.name ?? "—"}
      </span>
    </div>
  )
}
