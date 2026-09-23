import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8")

test("billing settings appears before billing details in the sidebar", async () => {
  const sidebar = await source("components/app-sidebar.tsx")
  const billing = sidebar.split('title: t("sections.billingManagement")')[1]
  assert.match(billing, /url: CONSOLE_ROUTES\.billingSettings/)
  assert.ok(
    billing.indexOf('title: t("pages.billingSettings.title")') <
      billing.indexOf('title: t("pages.billingDetails.title")')
  )
})

test("billing settings use equal left and right columns on desktop", async () => {
  const page = await source("pages/billing-settings-page.tsx")

  assert.match(
    page,
    /<section className="flex min-h-0 flex-1 flex-col p-4 pt-px lg:h-\[calc\(100svh-5rem\)\] lg:flex-none lg:overflow-hidden">/
  )
  assert.match(
    page,
    /<div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-2 lg:items-stretch">/
  )
  assert.doesNotMatch(page, /row-span|xl:grid-cols-2/)
  assert.equal((page.match(/<ScrollArea/g) ?? []).length, 3)
  assert.match(
    page,
    /<div className="grid min-h-0 gap-4 lg:h-full lg:grid-rows-\[minmax\(0,1fr\)_minmax\(0,2fr\)\]">/
  )
  assert.equal(
    (page.match(/<Card className="min-h-80 lg:min-h-0">/g) ?? []).length,
    2
  )
  assert.match(
    page,
    /<CardContent className="min-h-0 flex-1">[\s\S]*?<ScrollArea className="-ms-1 -me-\(--card-spacing\) min-h-0 lg:flex-1">[\s\S]*?<div className="flex flex-col gap-1 ps-1 pe-\(--card-spacing\)">/
  )
  assert.match(
    page,
    /pages\.billingSettings\.groupQuota\.memberTitle[\s\S]*?<ScrollArea className="-me-\(--card-spacing\) min-h-0 min-w-0 flex-1 pe-\(--card-spacing\)">[\s\S]*?<ItemGroup className="gap-2">/
  )
  assert.match(
    page,
    /<ScrollArea className="min-h-0 lg:h-full">\s*<div className="grid gap-4 ps-px pe-3 pt-px pb-px">/
  )

  const columns = page
    .split(
      '<div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-2 lg:items-stretch">'
    )[1]
    .split("<Dialog")[0]
  const groupQuota = columns.indexOf("pages.billingSettings.groupQuota.title")
  assert.match(
    columns,
    /variant="secondary"\s+size="sm"\s+render=\{<Link to=\{CONSOLE_ROUTES\.membersAndGroups\} \/>\}[\s\S]*?groupQuota\.manageGroups/
  )
  const rightColumn = columns.indexOf(
    '<div className="grid gap-4 ps-px pe-3 pt-px pb-px">'
  )
  assert.ok(groupQuota >= 0 && groupQuota < rightColumn)

  const right = columns.slice(rightColumn)
  assert.doesNotMatch(right, /pages\.billingSettings\.quotaRefresh\.title/)
  assert.doesNotMatch(
    right,
    /pages\.billingSettings\.quotaRefresh\.description|按上海时区在自然周期开始时刷新，余额不结转|下次刷新：|Asia\/Shanghai/
  )
  assert.match(right, /pages\.billingSettings\.modelPricing\.title/)
  assert.doesNotMatch(right, /缓存命中从总输入中扣除后单独计价/)
  assert.match(right, /pages\.billingSettings\.toolPricing\.title/)
  assert.match(right, /pages\.billingSettings\.toolPricing\.description/)
  assert.match(right, /pages\.billingSettings\.toolPricing\.manage/)
  assert.match(
    right,
    /<Button\s+variant="secondary"\s+render=\{<Link to="\/console\/resources\/tools" \/>\}/
  )
  assert.match(right, /icon=\{LinkSquare02Icon\}\s+data-icon="inline-end"/)
  assert.ok(
    right.indexOf("pages.billingSettings.chargingMethod.title") <
      right.indexOf("pages.billingSettings.modelPricing.title")
  )
  assert.ok(
    right.indexOf("pages.billingSettings.modelPricing.title") <
      right.indexOf("pages.billingSettings.toolPricing.title")
  )
  assert.doesNotMatch(
    columns,
    /管理成员与分组|修改在下周期生效；当期补发请进入成员账户|成员自动继承所属分组的额度/
  )
})

test("member account uses integer key-value balances and dedicated actions", async () => {
  const page = await source("pages/billing-settings-page.tsx")
  const accountDialog = page.split("function AccountDialog")[1]

  assert.match(accountDialog, /credits\(value, i18n\.language, 0, "floor"\)/)
  assert.equal((accountDialog.match(/displayCredits\(/g) ?? []).length, 2)
  assert.match(
    accountDialog,
    /<dl className="divide-y rounded-lg border">[\s\S]*?\["可用", data\.account\.available\][\s\S]*?\["冻结", data\.account\.frozen\][\s\S]*?\["账面剩余", data\.account\.balance\][\s\S]*?\["满额度", data\.account\.quota\]/
  )
  assert.match(
    accountDialog,
    /调整积分[\s\S]*?CONSOLE_ROUTES\.billingDetails\}\?view=entries&user=\$\{encodeURIComponent\(user\.name\)\}[\s\S]*?费用明细/
  )
  assert.doesNotMatch(accountDialog, /查看费用明细/)
  assert.match(accountDialog, /\["add", "增加积分"\]/)
  assert.match(accountDialog, /\["deduct", "扣除积分"\]/)
  assert.match(
    accountDialog,
    /adjustmentType === "add"\s*\? adjustmentAmount\s*: `-\$\{adjustmentAmount\}`/
  )
  assert.match(accountDialog, /htmlFor="adjustment-amount">积分数量/)
  assert.match(accountDialog, /htmlFor="adjustment-reason">调整原因/)
  assert.doesNotMatch(
    accountDialog,
    /最近周期记录|周期额度：|当前周期：|调整当期积分|adjust-delta|adjust-reason|额度随所属分组自动继承|多组取最高值|管理成员分组/
  )
})

test("billing settings name automatic credit refresh explicitly", async () => {
  const zhCN = await source("i18n/locales/zh-CN.ts")
  assert.match(
    zhCN,
    /quotaRefresh: \{\s*title: "积分自动刷新",\s*description: "按周期自动刷新成员积分额度。",\s*itemTitle: "积分重置周期",\s*itemDescription: "\{\{cycle\}\}自动重置"/
  )
  assert.match(
    zhCN,
    /modelPricing: \{\s*title: "大模型扣费规则",\s*description: "设置大模型 Token 积分价格。"/
  )
  assert.match(zhCN, /manageMultiplier: "模型倍率设置"/)
  assert.match(zhCN, /cycle: "重置周期"/)
  assert.match(zhCN, /daily: "每天重置"/)
  assert.match(zhCN, /cycleLabels: \{\s*daily: "每天"/)
  assert.match(zhCN, /nextResetTitle: "下次重置时间"/)
  assert.match(
    zhCN,
    /chargingMethod: \{\s*title: "计费方式",\s*description: "配置系统资源的计费策略。"/
  )
  assert.match(
    zhCN,
    /modes: \{\s*disabled: "不计费",\s*local: "直接计费",\s*remote: "与百智云联动计费"/
  )
  assert.match(
    zhCN,
    /toolPricing: \{\s*title: "工具扣费规则",\s*description: "设置工具每次调用的积分消耗。",\s*manage: "工具费率设置"/
  )

  const locales = [
    "ar",
    "de-DE",
    "en-US",
    "es-419",
    "fr-FR",
    "ja-JP",
    "ko-KR",
    "ru-RU",
    "zh-CN",
    "zh-TW",
  ]
  for (const locale of locales) {
    const messages = await source(`i18n/locales/${locale}.ts`)
    assert.match(messages, /memberTitle: ".+"/, locale)
    assert.match(messages, /manageGroups: ".+"/, locale)
    assert.match(messages, /nextResetTitle: ".+"/, locale)
    assert.match(messages, /resetNow: ".+"/, locale)
    assert.match(messages, /resetDialogTitle: ".+"/, locale)
    assert.match(messages, /resetting: ".+"/, locale)
    assert.match(messages, /resetSuccess:\s*"[^"]*\{\{count\}\}[^"]*"/, locale)
    assert.match(messages, /remaining: ".*\{\{credits\}\}.*"/, locale)
    assert.match(messages, /billingDisabled: ".+"/, locale)
    assert.match(messages, /remoteBilling: ".+"/, locale)
  }
})

test("billing settings separate the group tree and member item list", async () => {
  const page = await source("pages/billing-settings-page.tsx")
  const userItem = page
    .split("const userItem =")[1]
    .split("const renderGroup =")[0]
  const groupRows = page
    .split("const renderGroup =")[1]
    .split("if (!settings")[0]

  assert.match(page, /FolderIcon/)
  assert.match(page, /Folder02Icon/)
  assert.match(groupRows, /group\/quota-row relative -mx-1/)
  assert.match(
    groupRows,
    /<Button[\s\S]*?className="w-full cursor-pointer justify-between[\s\S]*?onClick=\{openGroupQuota\}/
  )
  assert.match(
    groupRows,
    /<CollapsibleTrigger[\s\S]*?size="icon-sm"[\s\S]*?aria-label=\{`展开或折叠 \$\{g\.name\}`\}/
  )
  assert.match(groupRows, /absolute top-0 z-10/)
  assert.doesNotMatch(groupRows, /-translate-y-1\/2/)
  assert.match(groupRows, /group-aria-expanded:hidden/)
  assert.match(groupRows, /group-aria-expanded:block/)
  assert.match(groupRows, /const children = quotas\.groups\.filter/)
  assert.match(groupRows, /\{children\.length > 0 && \(/)
  assert.match(groupRows, /<CollapsibleContent className="pt-1">/)
  assert.match(groupRows, /children\.map\(\(child\) =>/)
  assert.match(groupRows, /<div className="flex flex-col gap-1">/)
  assert.doesNotMatch(
    groupRows,
    /quotas\.users|userItem|border-s border-border/
  )
  assert.match(
    groupRows,
    /text-muted-foreground tabular-nums transition-colors group-hover\/quota-row:text-foreground/
  )

  assert.match(userItem, /<div key=\{user\.id\} role="listitem">/)
  assert.match(userItem, /<Item\s+size="sm"\s+variant="outline"\s+render=/)
  assert.match(
    userItem,
    /<Button\s+type="button"\s+variant="ghost"\s+className="h-auto cursor-pointer justify-start text-start whitespace-normal hover:bg-muted"\s+onClick=\{\(\) => setAccountUser\(user\)\}/
  )
  assert.match(userItem, /<ItemMedia>/)
  assert.match(userItem, /<ItemContent className="min-w-0">/)
  assert.match(userItem, /<ItemTitle/)
  assert.doesNotMatch(userItem, /<ItemDescription|\{user\.email\}/)
  assert.match(userItem, /<ItemActions>/)
  assert.match(userItem, /icon=\{User02Icon\}/)
  assert.match(userItem, /text-blue-600 dark:text-blue-400/)
  assert.match(userItem, /groupQuota\.remaining/)
  assert.match(
    userItem,
    /const balance = user\.balance_credits[\s\S]*?balance === undefined \? "—" : format\(balance\)/
  )
  assert.doesNotMatch(
    userItem,
    /user\.available_credits|balance_credits \?\? quota\.effective/
  )
  assert.match(
    page,
    /onClose=\{\(\) => \{\s*setAccountUser\(null\)\s*refreshQuotas\(\)\s*\}\}/
  )
  assert.match(page, /onChanged=\{refreshQuotas\}/)
  assert.doesNotMatch(
    userItem,
    /periodicQuotaLabel|group-hover\/quota-user|openQuota|type: "user"|quota\.own/
  )

  assert.match(
    page,
    /const savedLocalBilling =\s*settings\?\.policy\.enabled && settings\.policy\.charging_mode === "local"/
  )
  assert.match(
    page,
    /groupQuota\.\$\{settings\?\.policy\.enabled \? "remoteBilling" : "billingDisabled"\}/
  )
  assert.doesNotMatch(page, /localBilling = enabled && mode === "local"/)
  assert.match(page, /quotaRefresh\.cycleLabels\.\$\{cycle\}/)
  assert.match(page, /groupQuota\.summary/)
})

test("billing settings forms use the shared shadcn controls", async () => {
  const page = await source("pages/billing-settings-page.tsx")

  assert.match(page, /from "@\/components\/ui\/select"/)
  assert.match(page, /from "@\/components\/ui\/tabs"/)
  assert.doesNotMatch(page, /from "@\/components\/ui\/checkbox"/)
  assert.match(
    page,
    /\{enabled && mode === "local" && \([\s\S]*?quotaRefresh\.itemTitle[\s\S]*?quotaRefresh\.itemDescription/
  )
  assert.match(page, /open=\{cycleDialogOpen\}/)
  assert.match(page, /<Select\s+items=\{cycleItems\}\s+value=\{cycleValue\}/)
  assert.match(page, /<SelectTrigger id="billing-cycle" className="w-full">/)
  assert.match(page, /save\("cycle", undefined, undefined, cycleValue\)/)
  assert.match(
    page,
    /quotaRefresh\.nextResetTitle[\s\S]*?<\/ItemContent>\s*<ItemActions>[\s\S]*?dateTime\(settings\.next_refresh_at\)/
  )
  assert.doesNotMatch(
    page,
    /settings\.policy\.pending_cycle &&|当前周期规则为|重置并切换为/
  )
  assert.match(page, /<Select\s+items=\{modeItems\}\s+value=\{selectedMode\}/)
  assert.match(page, /const selectedMode = enabled \? mode : "disabled"/)
  assert.equal((page.match(/useState\("weekly"\)/g) ?? []).length, 2)
  assert.match(page, /const \[enabled, setEnabled\] = useState\(true\)/)
  assert.match(page, /renderGroup\(g, "10000"\)/)
  assert.doesNotMatch(page, /type: "group" \| "user"|个人自定义额度优先/)
  assert.match(page, /pages\.billingSettings\.chargingMethod\.description/)
  assert.match(page, /pages\.billingSettings\.chargingMethod\.modes\.disabled/)
  assert.match(page, /pages\.billingSettings\.chargingMethod\.modes\.local/)
  assert.match(page, /pages\.billingSettings\.chargingMethod\.modes\.remote/)
  assert.match(page, /<Tabs\s+className="my-5"\s+value=\{quotaMode\}/)
  assert.match(page, /<TabsTrigger[\s\S]*?value="inherit"[\s\S]*?继承上级额度/)
  assert.match(page, /<TabsTrigger value="custom">自定义额度<\/TabsTrigger>/)
  assert.match(
    page,
    /<TabsContent value="inherit"[\s\S]*?<Item variant="outline">[\s\S]*?上级额度[\s\S]*?formatQuota\(target\?\.inherited \?\? "0"\)[\s\S]*?积分/
  )
  assert.match(
    page,
    /<TabsContent value="custom"[\s\S]*?<Input[\s\S]*?id="quota-value"[\s\S]*?inputMode="numeric"[\s\S]*?pattern="\[0-9\]\*"/
  )
  assert.match(
    page,
    /const integerQuotaValue = \(value: string\) => value\.split\("\.", 1\)\[0\]/
  )
  assert.match(page, /credits\(value, i18n\.language, 0, "floor"\)/)
  assert.doesNotMatch(page, /0 表示没有付费额度/)
  assert.match(page, /if \(value === "disabled"\) \{\s*setEnabled\(false\)/)
  assert.match(page, /setMode\(value\)\s*setEnabled\(true\)/)
  assert.doesNotMatch(page, /<Checkbox/)
  assert.doesNotMatch(
    page,
    /调用前预留积分，按真实用量结算|当前仅记录调用，不扣积分|百智云扣款与本地周期额度分别管理|已绑定.*位成员|未绑定成员无法发起远程付费调用|billing-enabled|<select|<option|type="checkbox"|aria-pressed=/
  )
})

test("immediate quota reset submits selected groups and members", async () => {
  const page = await source("pages/billing-settings-page.tsx")
  const dialog = page
    .split("open={resetDialogOpen}")[1]
    .split("open={cycleDialogOpen}")[0]

  assert.match(
    page,
    /import \{\s*GroupSelect,\s*type GroupSelectionValue,\s*\} from "@\/components\/group-select"/
  )
  assert.match(
    page,
    /variant="secondary"\s+size="sm"\s+className="w-full"[\s\S]*?setResetSelection\(\{ groupIds: \[\], userIds: \[\] \}\)[\s\S]*?setResetDialogOpen\(true\)[\s\S]*?quotaRefresh\.resetNow/
  )
  assert.match(dialog, /quotaRefresh\.resetDialogTitle/)
  assert.match(dialog, /quotaRefresh\.resetDialogDescription/)
  assert.match(dialog, /<GroupSelect/)
  assert.match(dialog, /options=\{quotas\.groups\.map/)
  assert.match(dialog, /users=\{quotas\.users\.map/)
  assert.match(dialog, /value=\{resetSelection\}/)
  assert.match(
    dialog,
    /onValueChange=\{\(value\) => \{[\s\S]*?setResetSelection\(value\)[\s\S]*?setResetRequestID\(crypto\.randomUUID\(\)\)/
  )
  assert.match(dialog, /selectionMode="both"/)
  assert.match(dialog, /searchable/)
  assert.match(dialog, /cascadeGroups/)
  assert.match(dialog, /variant="destructive"/)
  assert.match(dialog, /resetSelection\.groupIds\.length === 0/)
  assert.match(dialog, /resetSelection\.userIds\.length === 0/)
  assert.match(dialog, /busy === "reset"/)
  assert.match(
    page,
    /api<\{ reset_count: number \}>\(\s*"\/api\/admin\/v1\/billing\/quotas\/reset"/
  )
  assert.match(page, /group_ids: resetSelection\.groupIds/)
  assert.match(page, /user_ids: resetSelection\.userIds/)
  assert.match(page, /idempotency_key: resetRequestID/)
  assert.match(page, /setResetRequestID\(crypto\.randomUUID\(\)\)/)
  assert.match(page, /quotaRefresh\.resetSuccess/)
  assert.doesNotMatch(dialog, /quotaRefresh\.resetPreview/)
})

test("model pricing uses configurable items instead of inline inputs", async () => {
  const [page, zhCN] = await Promise.all([
    source("pages/billing-settings-page.tsx"),
    source("i18n/locales/zh-CN.ts"),
  ])

  assert.match(page, /<ItemGroup className="gap-2">/)
  assert.match(page, /<Item key=\{field\.key\} variant="outline">/)
  assert.match(page, /<ItemTitle>/)
  assert.match(page, /<ItemDescription>/)
  assert.match(page, /<ItemActions>/)
  assert.match(
    page,
    /variant="secondary"\s+size="sm"\s+onClick=\{\(\) => openPricing\(field\.key\)\}/
  )
  assert.match(page, /open=\{pricingTarget !== null\}/)
  assert.match(page, /id="model-pricing-value"/)
  assert.match(
    page,
    /void save\("pricing", undefined, nextPricing\)\.then\(\(saved\) =>/
  )
  assert.match(page, /if \(!saved\) return\s*setPricing\(nextPricing\)/)
  const modelCard = page
    .split("pages.billingSettings.modelPricing.title")[1]
    .split("pages.billingSettings.toolPricing.title")[0]
  assert.doesNotMatch(modelCard, /<CardAction>/)
  assert.match(
    modelCard,
    /variant="secondary"\s+render=\{<Link to="\/console\/resources\/models" \/>\}/
  )
  assert.match(modelCard, /modelPricing\.manageMultiplier/)
  assert.match(modelCard, /icon=\{LinkSquare02Icon\}\s+data-icon="inline-end"/)
  assert.doesNotMatch(page, /<Input\s+id=\{key\}/)
  assert.match(zhCN, /inputToken: "输入（未命中缓存）Token 费用"/)
  assert.match(zhCN, /cachedInputToken: "输入（命中缓存）Token 费用"/)
  assert.match(zhCN, /outputToken: "输出 Token 费用"/)
  assert.match(
    zhCN,
    /inputTokenDescription:\s*"百万输入（未命中缓存）Token 消耗 \{\{credits\}\} 积分"/
  )
  assert.doesNotMatch(zhCN, /valueDescription:/)
  assert.doesNotMatch(page, /modelPricing\.valueDescription/)
})

test("billing save buttons only appear after their form changes", async () => {
  const [page, wallet] = await Promise.all([
    source("pages/billing-settings-page.tsx"),
    source("components/billing/wallet-settings.tsx"),
  ])

  assert.doesNotMatch(page, /hasQuotaChanges|setChanges|save\("quotas"\)/)
  assert.match(page, /const saveQuota = async \(event: FormEvent\)/)
  assert.match(
    page,
    /changes: \[\s*\{\s*subject_type: target\.type,\s*id: target\.id,\s*credits: quotaMode === "inherit" \? null : quotaValue/
  )
  assert.match(page, /<form onSubmit=\{saveQuota\}>/)
  assert.match(page, /busy === "quota" \? "保存中…" : "保存"/)
  assert.doesNotMatch(page, /加入待保存变更/)
  assert.doesNotMatch(page, /const dirtyCycle =/)
  assert.doesNotMatch(page, /const dirtyPricing =/)
  assert.match(page, /const dirtyMode =/)
  assert.doesNotMatch(page, /dirtyCycle \|\| busy === "cycle"/)
  assert.doesNotMatch(page, /dirtyPricing \|\| busy === "pricing"/)
  assert.match(page, /\{\(dirtyMode \|\| busy === "mode"\) && \(/)
  assert.match(wallet, /\{\(dirty \|\| saving\) && \(/)
  assert.match(wallet, /t\("pages\.billingSettings\.save"\)/)
  assert.match(wallet, /htmlFor="billing-wallet-url">Base URL<\/FieldLabel>/)
  assert.match(wallet, /htmlFor="billing-wallet-app">App ID<\/FieldLabel>/)
  const baseURL = wallet.indexOf('id="billing-wallet-url"')
  const appID = wallet.indexOf('id="billing-wallet-app"')
  const caCertificate = wallet.indexOf(
    "certificates.slice(2).map(certificateField)"
  )
  const clientCredentials = wallet.indexOf(
    "certificates.slice(0, 2).map(certificateField)"
  )
  assert.ok(
    baseURL < appID &&
      appID < caCertificate &&
      caCertificate < clientCredentials
  )
  assert.doesNotMatch(wallet, /grid gap-4 sm:grid-cols-2/)
  assert.doesNotMatch(
    wallet,
    /space-y-4 rounded-md border p-4 text-sm|<h3 className="font-medium">百智云连接配置<\/h3>|保存连接配置|保存时校验证书格式|填写百智云服务地址|填写该百智云服务对应的应用 ID|最大 64 KiB|首次配置需要上传|hint: /
  )
})
