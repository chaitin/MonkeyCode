import { useMemo, useState, type ComponentProps } from "react"
import {
  ar,
  de,
  enUS,
  es,
  fr,
  ja,
  ko,
  ru,
  zhCN,
  zhTW,
  type Locale,
} from "date-fns/locale"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const DATE_LOCALES: Record<string, Locale> = {
  ar,
  de,
  en: enUS,
  es,
  fr,
  ja,
  ko,
  ru,
  zh: zhCN,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
}

export function DatePickerField({
  id,
  className,
  label,
  placeholder,
  locale,
  value,
  onChange,
  disabled,
}: {
  id: string
  className?: string
  label: string
  placeholder: string
  locale: string
  value: Date | undefined
  onChange: (value: Date | undefined) => void
  disabled?: ComponentProps<typeof Calendar>["disabled"]
}) {
  const [open, setOpen] = useState(false)
  const language = locale.split("-")[0]
  const calendarLocale = DATE_LOCALES[locale] ?? DATE_LOCALES[language] ?? enUS
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale]
  )

  return (
    <Field className={cn("sm:w-48", className)}>
      <FieldLabel htmlFor={id} className="sr-only">
        {label}
      </FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className={cn(
                "w-full justify-start px-2.5 font-normal",
                !value && "text-muted-foreground"
              )}
            />
          }
        >
          {value ? formatter.format(value) : placeholder}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value}
            onSelect={(date) => {
              onChange(date)
              if (date) setOpen(false)
            }}
            disabled={disabled}
            locale={calendarLocale}
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}
