import {
  ResourceBatchActions,
  type ResourceBatchActionsProps,
} from "@/components/resource-batch-actions"

export function SkillBatchActions(
  props: Omit<ResourceBatchActionsProps, "kind">
) {
  return <ResourceBatchActions {...props} kind="skill" />
}
