import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("operation log card keeps its top ring inside the clipped viewport", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /flex-col p-4 pt-px md:h-\[calc\(100svh-5rem\)\]/)
  assert.doesNotMatch(source, /flex-col p-4 pt-0/)
})

test("operation logs show 50 rows per page by default", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /const DEFAULT_PAGE_SIZE = 50/)
})

test("operation log filters use shared date pickers and local day boundaries", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.equal((source.match(/<DatePickerField/g) ?? []).length, 2)
  assert.match(source, /startOfLocalDay\(sinceInput\)/)
  assert.match(source, /endOfLocalDay\(untilInput\)/)
  assert.match(
    source,
    /disabled=\{untilInput \? \{ after: untilInput \} : undefined\}/
  )
  assert.match(
    source,
    /disabled=\{sinceInput \? \{ before: sinceInput \} : undefined\}/
  )
  assert.doesNotMatch(source, /type="datetime-local"/)
  assert.doesNotMatch(source, /requestParamsInput|requestParamsQuery/)
  assert.doesNotMatch(source, /filters\.requestParamsSearchPlaceholder/)
  assert.doesNotMatch(source, /params: requestParamsQuery/)
  assert.equal((source.match(/className="w-32"/g) ?? []).length, 2)
  assert.equal((source.match(/className="w-32 sm:w-32"/g) ?? []).length, 2)

  const filterRow = source
    .split(
      'className="flex flex-wrap items-center gap-2 px-(--card-spacing)"'
    )[1]
    .split("</div>")[0]
  assert.ok(
    filterRow.lastIndexOf("<DatePickerField") <
      filterRow.indexOf("<DropdownMenu>")
  )
  assert.ok(
    filterRow.lastIndexOf("<DropdownMenu>") <
      filterRow.indexOf('<Button type="button" onClick={applySearch}>')
  )
  assert.match(source, /useState<CategoryFilter>\(null\)/)
  assert.match(source, /useState<ResultFilter>\(null\)/)
  assert.match(source, /<DropdownMenuCheckboxItem/)
  assert.match(source, /setCategoryInput\(checked \? value : null\)/)
  assert.match(source, /setResultInput\(checked \? value : null\)/)
  assert.doesNotMatch(source, /filters\.allActions|filters\.allResults/)
  assert.doesNotMatch(source, /DropdownMenuRadioItem|DropdownMenuRadioGroup/)

  const picker = await readFile(
    new URL("../src/components/date-picker-field.tsx", import.meta.url),
    "utf8"
  )
  assert.match(picker, /<Calendar/)
  assert.match(picker, /mode="single"/)
  assert.match(picker, /<Popover/)
  assert.match(picker, /!value && "text-muted-foreground"/)
  assert.doesNotMatch(picker, /Calendar03Icon|HugeiconsIcon/)
  assert.doesNotMatch(picker, /captionLayout="dropdown"/)
})

test("operation log pagination uses matching arrow icons", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /icon=\{ArrowLeft01Icon\}/)
  assert.match(source, /icon=\{ArrowRight01Icon\}/)
  assert.doesNotMatch(source, /ArrowLeft02Icon/)
})

test("operation log actors use the same blue user icon as tree members", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /User02Icon/)
  assert.match(
    source,
    /icon=\{User02Icon\}\s+className="size-4 shrink-0 text-blue-600 dark:text-blue-400"/
  )
  assert.doesNotMatch(source, /<Avatar|AvatarFallback|actor_name\.slice/)
  assert.match(source, /title=\{log\.actor_email \?\? undefined\}/)
  assert.match(source, /\{log\.actor_name\}/)
})

test("operation log action uses target-action order without a second ID line", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    source,
    /`\$\{t\(`audit\.targets\.\$\{log\.target_type\}`[\s\S]*?\}\)\} - \$\{t\(`audit\.actions\.\$\{log\.action\}`/
  )
  const row = source
    .split("visibleLogs.map((log) => (")[1]
    .split("</TableRow>")[0]
  assert.match(row, /<TableCell>\{actionLabel\(log\)\}<\/TableCell>/)
  assert.doesNotMatch(source, /\{log\.target_id && \(/)
  assert.match(source, /\[t\("audit\.target"\), log\.target_id\]/)
})

test("operation log result appears before the operator", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  const header = source.split("<TableHeader")[1].split("</TableHeader>")[0]
  assert.ok(
    header.indexOf('columns.result")') < header.indexOf('columns.operator")')
  )

  const row = source
    .split("visibleLogs.map((log) => (")[1]
    .split("</TableRow>")[0]
  assert.ok(row.indexOf("log.result ===") < row.indexOf("log.actor_name"))
  assert.match(
    row,
    /<TableCell className="font-mono text-muted-foreground">\s*\{log\.source_ip \|\| "—"\}/
  )
})

test("operation log details are opened from the last actions column", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  const header = source.split("<TableHeader")[1].split("</TableHeader>")[0]
  assert.doesNotMatch(header, /columns\.requestParams/)
  assert.ok(
    header.indexOf('columns.ipAddress")') <
      header.indexOf('columns.operations")')
  )
  assert.match(
    header,
    /<TableHead className="pe-\(--card-spacing\)">\s*\{t\("pages\.operationLogs\.columns\.operations"\)\}/
  )

  const row = source
    .split("visibleLogs.map((log) => (")[1]
    .split("</TableRow>")[0]
  assert.match(row, /<TableCell className="pe-\(--card-spacing\)">\s*<Dialog>/)
  assert.match(
    row,
    /<Button\s+variant="outline"\s+size="xs"\s+type="button"\s*\/>/
  )
  assert.match(row, /\{t\("pages\.operationLogs\.details"\)\}/)
  assert.match(row, /JSON\.stringify\(log\.request_params, null, 2\)/)
  assert.doesNotMatch(row, /JSON\.stringify\(log\.request_params\)\s*<\/span>/)
  assert.doesNotMatch(row, /<DialogDescription>/)
  assert.match(row, /grid-cols-\[9rem_minmax\(0,1fr\)\]/)
  assert.match(row, /columns\.time"\),\s*dateFormatter\.format/)
  assert.match(
    row,
    /columns\.operator"\),\s*log\.actor_email\s*\? `\$\{log\.actor_name\} \(\$\{log\.actor_email\}\)`/
  )
  assert.match(row, /columns\.action"\),\s*actionLabel\(log\)/)
})

test("only the operation log table scrolls and its header stays visible", async () => {
  const source = await readFile(
    new URL("../src/pages/operation-logs-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    source,
    /<section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-\[calc\(100svh-5rem\)\] md:flex-none md:overflow-hidden">/
  )
  assert.match(source, /<Card className="min-h-0 flex-1">/)
  assert.match(source, /<CardContent className="min-h-0 flex-1 gap-4 px-0">/)
  assert.match(
    source,
    /<ScrollArea\s+horizontal\s+className="min-h-0 flex-1 \[&_\[data-slot=table-container\]\]:overflow-visible"/
  )
  assert.match(
    source,
    /<TableHeader className="sticky top-0 z-10 bg-card \[&_th\]:shadow-\[inset_0_-1px_0_var\(--border\)\] \[&_tr\]:border-b-0">/
  )
  assert.ok(
    source.indexOf("</ScrollArea>") <
      source.indexOf('pagination.pageSizeLabel")')
  )

  const scrollArea = await readFile(
    new URL("../src/components/ui/scroll-area.tsx", import.meta.url),
    "utf8"
  )
  assert.match(scrollArea, /horizontal = false/)
  assert.match(scrollArea, /"z-20 flex touch-none/)
  assert.match(
    scrollArea,
    /horizontal && <ScrollBar orientation="horizontal" \/>/
  )
})
