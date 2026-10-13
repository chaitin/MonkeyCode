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
    <div className="w-full max-w-full min-w-0 overflow-hidden">
      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full max-w-full min-w-0 overflow-hidden"
        aria-label={file ? `${chooseLabel}: ${file.name}` : undefined}
        onClick={() => inputRef.current?.click()}
      >
        <span
          className="block max-w-full min-w-0 flex-1 truncate text-start"
          title={file?.name}
        >
          {file?.name ?? chooseLabel}
        </span>
      </Button>
    </div>
  )
}
