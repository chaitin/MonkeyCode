const OTHER_OPTION_LABELS = new Set(["其它", "其他", "Other"])

export function getAskUserOptionDisplayLabel(
  label: string | null | undefined,
  otherLabel: string,
): string {
  if (!label) {
    return ""
  }

  return OTHER_OPTION_LABELS.has(label.trim()) ? otherLabel : label
}
