import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8")

test("skill tags load only for administrators and report request failures with toast", async () => {
  const [main, provider] = await Promise.all([
    source("main.tsx"),
    source("components/skill-tags-provider.tsx"),
  ])

  assert.ok(
    main.indexOf("<AnimatedToastProvider>") <
      main.indexOf("<SkillTagsProvider>")
  )
  assert.match(provider, /user\?\.role !== "admin"/)
  assert.match(provider, /loadedForUser === user/)
  assert.match(provider, /showToast\(\{ status: "error"/)
  assert.doesNotMatch(provider, /isAuthenticated/)
  assert.doesNotMatch(provider, /role="alert"/)
})

test("shared resource mutations use toast instead of stored inline errors", async () => {
  const resources = await source("lib/resources.ts")

  assert.match(resources, /showToast\(\{ status: "success"/)
  assert.match(resources, /showToast\(\{\s*status: "error"/)
  assert.match(resources, /action: \{\s*label: t\("statistics\.retry"\)/)
  assert.match(resources, /error: ""/)
  assert.doesNotMatch(resources, /const \[error, setError\]/)
})

test("page-level operation failures no longer render global destructive banners", async () => {
  const [members, models, billing, credentials, experts] = await Promise.all([
    source("pages/members-and-groups-page.tsx"),
    source("pages/models-page.tsx"),
    source("pages/billing-settings-page.tsx"),
    source("components/connector-credentials.tsx"),
    source("pages/experts-page.tsx"),
  ])

  assert.doesNotMatch(members, /const \[error, setError\]/)
  assert.doesNotMatch(models, /const \[error, setError\]/)
  assert.doesNotMatch(billing, /setNotice|const \[notice/)
  assert.doesNotMatch(credentials, /setNotice|const \[notice/)
  assert.doesNotMatch(experts, /optionError|setOptionError/)
  assert.match(models, /resources\.operationCompleted/)
  assert.match(billing, /showToast\(\{ status: "error"/)
})

test("field and persistent-state errors remain inline", async () => {
  const [bulkMembers, operationLogs, wallet] = await Promise.all([
    source("components/members/bulk-add-members-form.tsx"),
    source("pages/operation-logs-page.tsx"),
    source("components/billing/wallet-settings.tsx"),
  ])

  assert.match(bulkMembers, /inputError &&/)
  assert.match(bulkMembers, /row\.error/)
  assert.match(operationLogs, /invalidRange &&/)
  assert.match(wallet, /info\.error &&/)
  assert.match(wallet, /e instanceof ApiError/)
})
