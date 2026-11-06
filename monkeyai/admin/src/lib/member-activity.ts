import {
  addDays,
  eachDayOfInterval,
  format,
  startOfDay,
  startOfWeek,
  subYears,
} from "date-fns"

export function memberActivityYear(until: Date) {
  const end = startOfDay(until)
  const start = addDays(subYears(end, 1), 1)
  const firstWeek = startOfWeek(start, { weekStartsOn: 0 })
  const dates = eachDayOfInterval({ start, end })
  const offset = start.getDay()
  const weekCount = Math.ceil((offset + dates.length) / 7)
  const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = addDays(firstWeek, index)
    return date < start || date > end ? null : format(date, "yyyy-MM-dd")
  })
  return { start, end, cells, weekCount }
}

export function memberActivityBounds(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`)
  return {
    from: start.toISOString(),
    until: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  }
}

export function memberActivityOpacity(conversations: number) {
  return Number.isFinite(conversations)
    ? Math.min(1, Math.max(0, conversations) / 20)
    : 0
}
