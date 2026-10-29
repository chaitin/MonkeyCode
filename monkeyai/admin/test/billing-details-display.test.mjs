import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

import { credits } from "../src/lib/billing.ts"

test("billing credits can be rounded to integers without losing large values", () => {
  assert.equal(credits("1234", "en-US", 0), "1,234")
  assert.equal(credits("1234.49", "en-US", 0), "1,234")
  assert.equal(credits("1234.5", "en-US", 0), "1,235")
  assert.equal(credits("999999999999.5", "en-US", 0), "1,000,000,000,000")
  assert.equal(credits("-0.5", "en-US", 0), "-1")
  assert.equal(credits("1.01", "en-US", 0, "expand"), "2")
  assert.equal(credits("-1.01", "en-US", 0, "expand"), "-2")
  assert.equal(credits("1.99", "en-US", 0, "floor"), "1")
  assert.equal(credits("-1.01", "en-US", 0, "floor"), "-2")
  assert.equal(credits(null, "en-US", 0), "—")
})

test("billing detail user columns match the operation log actor presentation", async () => {
  const source = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /<UserAvatar src=\{e\.user_avatar_url\}/)
  assert.match(source, /<UserAvatar src=\{tx\.user_avatar_url\}/)
  assert.doesNotMatch(source, /User02Icon/)
  assert.match(source, /title=\{e\.user_email\}/)
  assert.match(source, /<span className="truncate">\{e\.user_name\}<\/span>/)
  assert.match(source, /title=\{tx\.user_email\}/)
  assert.match(source, /<span className="truncate">\{tx\.user_name\}<\/span>/)
  assert.doesNotMatch(
    source,
    /text-xs text-muted-foreground">\s*\{e\.user_email\}/
  )
})

test("billing views use tabs and tables scroll inside the available page height", async () => {
  const source = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /md:h-\[calc\(100vh-5rem\)\]/)
  assert.match(source, /<Tabs\s+value=\{view\}/)
  assert.match(source, /<TabsTrigger value="entries">积分流水<\/TabsTrigger>/)
  assert.match(
    source,
    /<TabsTrigger value="pending">待处理与对账<\/TabsTrigger>/
  )
  assert.equal((source.match(/<ScrollArea/g) ?? []).length, 3)
  assert.equal(
    (source.match(/<TableHeader className="sticky top-0 z-10">/g) ?? []).length,
    2
  )
  assert.equal(
    (source.match(/data-slot=table-container\]\]:h-full/g) ?? []).length,
    2
  )
  assert.equal((source.match(/<TableRow className="h-full">/g) ?? []).length, 2)
  assert.equal(
    (
      source.match(/className="h-full text-center text-muted-foreground"/g) ??
      []
    ).length,
    2
  )
  assert.match(source, /className="min-h-0 flex-1 gap-4 px-0"/)
  assert.doesNotMatch(source, /billing\/summary|summary\.charges|扣费积分/)
  assert.doesNotMatch(source, /w-px|max-w-52|table-fixed/)
  assert.equal(
    (source.match(/TableHead className="ps-\[var\(--card-spacing\)\]"/g) ?? []).length,
    2
  )
  assert.equal(
    (
      source.match(
        /TableCell className="ps-\[var\(--card-spacing\)\] whitespace-nowrap text-muted-foreground"/g
      ) ?? []
    ).length,
    2
  )
  assert.equal(
    (
      source.match(
        /className="w-20 pe-\[var\(--card-spacing\)\] whitespace-nowrap"/g
      ) ?? []
    ).length,
    4
  )
  assert.match(
    source,
    /<TableHead className="text-start">积分变动<\/TableHead>/
  )
  assert.match(
    source,
    /<TableHead className="text-start">剩余积分<\/TableHead>/
  )
  assert.match(source, /className=\{`text-start font-medium tabular-nums/)
  assert.match(
    source,
    /<TableCell className="text-start text-yellow-600 tabular-nums dark:text-yellow-400">/
  )
})

test("billing filters match the compact operation-log interaction", async () => {
  const source = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  const filters = source.split("onSubmit={search}")[1].split("</form>")[0]
  assert.match(
    filters,
    /flex flex-wrap items-center gap-2 px-\[var\(--card-spacing\)\]/
  )
  assert.equal((filters.match(/className="w-32"/g) ?? []).length, 1)
  assert.match(filters, /<BillingUserSearch/)
  assert.equal((filters.match(/<DatePickerField/g) ?? []).length, 2)
  assert.match(filters, /className="w-32 sm:w-32"/)
  assert.equal((filters.match(/<DropdownMenu>/g) ?? []).length, 3)
  assert.match(filters, /visibleFields\.has\("content"\)/)
  assert.match(filters, /visibleFields\.has\("entryType"\)/)
  assert.match(filters, /DropdownMenuCheckboxItem/)
  assert.match(filters, /icon=\{searching \? Loading03Icon : Search02Icon\}/)
  assert.match(filters, /disabled=\{loading \|\| searching\}/)
  assert.match(filters, /animate-spin motion-reduce:animate-none/)
  assert.doesNotMatch(filters, /type="date"|<select|<FieldLabel|重置/)
  assert.match(source, /startOfLocalDay\(value\)\.toISOString\(\)/)
  assert.match(source, /endOfLocalDay\(value\)\.toISOString\(\)/)
})

test("billing search only loads inside its button and reports the result by toast", async () => {
  const source = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  const searchHandler = source
    .split("const search =")[1]
    .split("const total =")[0]
  assert.match(searchHandler, /if \(searching\) return/)
  assert.match(searchHandler, /setSearching\(true\)/)
  assert.doesNotMatch(searchHandler, /setLoading\(true\)/)
  assert.match(source, /if \(!isSearch\) setLoadFailed\(true\)/)
  assert.match(source, /status: "success"[\s\S]*?filters\.searchSuccess/)
  assert.match(source, /status: "error", title: e\.message/)
  assert.match(source, /if \(isSearch\) \{[\s\S]*?setSearching\(false\)/)
})

test("billing details pagination matches operation logs and defaults to 50 rows", async () => {
  const source = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /\[page, setPage\] = useState\(1\)/)
  assert.match(source, /\[pageSize, setPageSize\] = useState\(50\)/)
  assert.match(source, /requestParams\.set\("page", String\(page\)\)/)
  assert.match(source, /requestParams\.set\("page_size", String\(pageSize\)\)/)
  assert.match(source, /next\.delete\("page"\)/)
  assert.match(source, /next\.delete\("page_size"\)/)
  assert.doesNotMatch(source, /navigate\(\{ page|navigate\(\{ page_size/)
  assert.match(source, /<TablePagination/)
  const pagination = await readFile(
    new URL("../src/components/table-pagination.tsx", import.meta.url),
    "utf8"
  )
  const selector = await readFile(
    new URL("../src/components/page-size-select.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    selector,
    /import \{ PAGE_SIZE_OPTIONS \} from "@\/lib\/pagination"/
  )
  assert.match(pagination, /pages\.operationLogs\.pagination\.summary/)
  assert.match(selector, /pages\.operationLogs\.pagination\.pageSizeLabel/)
  assert.match(pagination, /size="icon-sm"/)
  assert.match(pagination, /icon=\{ArrowLeft01Icon\}/)
  assert.match(pagination, /icon=\{ArrowRight01Icon\}/)
  assert.match(pagination, /className="\[\[dir=rtl\]_&\]:rotate-180"/)
})

test("billing transaction details follow the credit account key-value layout", async () => {
  const billingSource = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  const accountSource = await readFile(
    new URL("../src/components/billing/account-dialog.tsx", import.meta.url),
    "utf8"
  )
  const transactionDialog = billingSource.split("function TransactionDialog")[1]
  const rowLayout =
    'className="flex items-center justify-between gap-4 px-4 py-3 text-sm"'
  assert.match(
    transactionDialog,
    /<ScrollArea className="rounded-lg border [^"]*max-h-\[min\(40vh,24rem\)\]">\s*<dl className="divide-y">/
  )
  assert.ok(accountSource.includes('className="divide-y rounded-lg border"'))
  assert.ok(transactionDialog.includes(rowLayout))
  assert.ok(accountSource.includes(rowLayout))
  assert.match(transactionDialog, /min-w-0 text-right break-all tabular-nums/)
  assert.match(transactionDialog, /label: "用户", value: data\.user_name/)
  assert.match(transactionDialog, /label: "内容", value: data\.item_name/)
  assert.match(
    transactionDialog,
    /label: "状态", value: stateNames\[data\.status\]/
  )
  assert.match(transactionDialog, /label: "交易 ID", value: data\.id/)
  assert.match(
    transactionDialog,
    /label: "上游响应 ID", value: data\.request_id/
  )
  assert.match(transactionDialog, /label: "普通输入 Token"/)
  assert.match(transactionDialog, /label: "缓存输入 Token"/)
  assert.match(transactionDialog, /label: "输出 Token"/)
  assert.doesNotMatch(
    transactionDialog,
    /act\("refund"\)|refund-reason|全额退款原因|退回原周期账户|退款保留原始扣款流水/
  )
  assert.doesNotMatch(
    transactionDialog,
    /每次调用：|模型倍率：|每百万 Token 积分/
  )
})

test("billing entries omit mode and use directional integer rounding", async () => {
  const source = await readFile(
    new URL("../src/pages/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /=>\s*credits\(value, locale, 0\)/)
  assert.match(source, /credits\(value, locale, 0, "expand"\)/)
  assert.match(source, /credits\(value, locale, 0, "floor"\)/)
  assert.equal((source.match(/\bcredits\(/g) ?? []).length, 3)
  assert.match(source, /changedCredits\(e\.credit_delta, i18n\.language\)/)
  assert.match(source, /balanceCredits\(e\.balance_after, i18n\.language\)/)
  assert.match(source, /billingCredits\(tx\.reserve, i18n\.language\)/)
  assert.match(source, /e\.credit_delta\.startsWith\("-"\)/)
  assert.match(source, /text-red-600 dark:text-red-400/)
  assert.match(source, /text-orange-600 dark:text-orange-400/)
  assert.match(
    source,
    /text-start text-yellow-600 tabular-nums dark:text-yellow-400/
  )
  assert.match(
    source,
    /\{entryLabel\(e\.entry_type\)\} -\s*\{" "\}\s*\{categoryLabel\(e\.category\)\}/
  )
  assert.match(source, /<TableCell>\{e\.item_name\}<\/TableCell>/)
  assert.equal(
    (source.match(/pages\.operationLogs\.columns\.operations/g) ?? []).length,
    2
  )
  assert.equal((source.match(/pages\.operationLogs\.details/g) ?? []).length, 2)
  assert.match(source, /variant="outline"\s+size="xs"/)
  assert.doesNotMatch(source, /查看详情/)
  assert.match(source, /onClick=\{\(\) => setSelected\(e\.transaction_id\)\}/)
  assert.match(source, /pages\.operationLogs\.details/)
  assert.doesNotMatch(source, /hover:text-primary hover:underline/)
  assert.match(
    source,
    /<TableCell className="ps-\[var\(--card-spacing\)\] whitespace-nowrap text-muted-foreground">\s*\{dateTime\(\s*e\.occurred_at,\s*TABLE_DATE_TIME_OPTIONS\s*\)\}/
  )
  assert.match(
    source,
    /pe-\[var\(--card-spacing\)\] whitespace-nowrap[\s\S]*?pages\.operationLogs\.columns\.operations/
  )
  assert.match(
    source,
    /ps-\[var\(--card-spacing\)\] whitespace-nowrap text-muted-foreground[\s\S]*?dateTime\(\s*tx\.started_at,\s*TABLE_DATE_TIME_OPTIONS\s*\)/
  )
  assert.match(
    source,
    /<TableCell className="w-20 pe-\[var\(--card-spacing\)\] whitespace-nowrap">[\s\S]*?<Button/
  )
  assert.match(source, /next\.delete\("mode"\)/)
  assert.doesNotMatch(
    source,
    /draft\.mode|aria-label="计费模式"|<TableHead>模式/
  )
  assert.match(source, /!entries\?\.items\.length[\s\S]*?colSpan=\{7\}/)
})
