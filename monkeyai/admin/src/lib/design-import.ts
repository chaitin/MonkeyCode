export type ImportSection = "agent" | "design"
export type Discovery = {
  available_sections: ImportSection[]
  sections: Record<ImportSection, { present: boolean; supported: boolean; schema_version?: number }>
}
export type DesignImportSummary = {
  publisher_id: string
  release_id: string
  schema_version: number
  counts: Record<"template" | "design-system" | "style" | "direction", number>
  changes: { kind: string; id: string; name: string; action: string }[]
}
export type SectionPlan = { plan_digest: string; already_imported?: boolean; design?: DesignImportSummary }
export type ImportResult = {
  status: "succeeded" | "partial" | "failed"
  warning?: string
  sections: Partial<Record<ImportSection, { status: "succeeded" | "failed"; replayed: boolean; error?: { code: string; message: string }; result?: { release_id?: string } }>>
}
export function defaultSections(discovery: Discovery): ImportSection[] {
  return discovery.available_sections.filter((section) => discovery.sections[section].supported)
}
export function designSummary(plans?: Partial<Record<ImportSection, SectionPlan>>): DesignImportSummary | null {
  return plans?.design?.design ?? null
}
export function sectionDigests(plans: Partial<Record<ImportSection, SectionPlan>>): Record<string, string> {
  return Object.fromEntries(Object.entries(plans).map(([section, plan]) => [section, plan.plan_digest]))
}
export function successfulSections(result: ImportResult): boolean {
  const sections = Object.values(result.sections)
  return result.status === "succeeded" && sections.length > 0 && sections.every((section) => section.status === "succeeded")
}
