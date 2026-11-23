import type { SVGProps } from "react"

import { cn } from "@/lib/utils"

type IconfontProps = SVGProps<SVGSVGElement> & {
  name: string
}

export function Iconfont({ name, className, ...props }: IconfontProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn("inline-block size-[1em] shrink-0", className)}
      focusable="false"
      {...props}
    >
      <use href={`#${name}`} />
    </svg>
  )
}
