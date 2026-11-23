import { GraduationCapIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ResourceAvatarField,
  type ResourceAvatarDraft,
} from "@/components/resource-avatar-field"

export type ExpertAvatarDraft = ResourceAvatarDraft

export function ExpertAvatarField(props: {
  src: string
  value: ExpertAvatarDraft
  onValueChange: (value: ExpertAvatarDraft) => void
  disabled: boolean
  loading: boolean
}) {
  return (
    <ResourceAvatarField
      {...props}
      id="expert-avatar"
      fallback={
        <HugeiconsIcon
          icon={GraduationCapIcon}
          className="size-8"
          strokeWidth={2}
        />
      }
    />
  )
}
