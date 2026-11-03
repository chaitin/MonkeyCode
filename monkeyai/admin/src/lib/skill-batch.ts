import { applyResourceBatch } from "./resource-batch.ts"

export type {
  ResourceBatchChange as SkillBatchChange,
  ResourceBatchResource as SkillBatchResource,
  ResourceBatchProgress as SkillBatchProgress,
  ResourceBatchResult as SkillBatchResult,
} from "./resource-batch.ts"

export function applySkillBatch(
  ...args: Parameters<typeof applyResourceBatch> extends [
    unknown,
    ...infer Rest,
  ]
    ? Rest
    : never
) {
  return applyResourceBatch("skill", ...args)
}
