import {
  useResourcePage,
  RESOURCE_PAGE_SIZE,
  type ResourceType,
} from "@/hooks/use-resource-list"

export type RuleType = ResourceType
export const RULE_PAGE_SIZE = RESOURCE_PAGE_SIZE

export function useRulePage(
  type: RuleType,
  cursor: string,
  search: string,
  pageSize = RULE_PAGE_SIZE
) {
  return useResourcePage("/rules", type, cursor, search, "items", pageSize)
}
