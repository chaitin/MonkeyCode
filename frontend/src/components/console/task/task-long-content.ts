export const hasCrossedTaskContentLimit = (
  previousLength: number,
  nextLength: number,
  maxLength: number,
) => previousLength <= maxLength && nextLength > maxLength

export const createLongContentFileName = (date: Date) => {
  const iso = date.toISOString()
  const day = iso.slice(0, 10).replaceAll("-", "")
  const time = iso.slice(11, 19).replaceAll(":", "")
  return `long-input-${day}-${time}.txt`
}

export const createLongContentTextFile = (
  content: string,
  filename: string,
  lastModified = Date.now(),
) => new File([content], filename, {
  type: "text/plain;charset=utf-8",
  lastModified,
})
