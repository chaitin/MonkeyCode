import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
export function ResourceNotice({
  error,
  loading,
  pending,
}: {
  error: string
  loading: boolean
  pending: boolean
}) {
  const { t } = useTranslation()
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error && errorRef.current?.closest("form")) {
      errorRef.current.focus()
    }
  }, [error])
  return (
    <>
      {error && (
        <p
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {(loading || pending) && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(pending ? "resources.saving" : "resources.loading")}
        </p>
      )}
    </>
  )
}
