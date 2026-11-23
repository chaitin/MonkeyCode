import { cn } from "@/lib/utils"

export function CircularProgress({
  value,
  className,
}: {
  value?: number
  className?: string
}) {
  const valid =
    value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100

  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={cn(
        "size-3 shrink-0",
        valid && value > 80
          ? "text-destructive"
          : valid && value > 50
            ? "text-orange-600 dark:text-orange-400"
            : undefined,
        className
      )}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.2"
      />
      {valid && (
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          strokeWidth="2"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - value}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
  )
}
