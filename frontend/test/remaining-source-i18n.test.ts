import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const cjkPattern = /[\u3400-\u9fff]/

const readSource = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")

const files = [
  "utils/queue.ts",
  "components/common/terminal.tsx",
  "utils/requestUtils.ts",
  "lib/agent-resources-api.ts",
  "hooks/useGitHubSetupCallback.ts",
  "pages/console/user/tasks.tsx",
  "components/manager/skill-package.ts",
]

test("remaining i18n cleanup files do not contain hard-coded Chinese", () => {
  for (const file of files) {
    assert.doesNotMatch(readSource(file), cjkPattern, file)
  }
})

test("remaining runtime messages are wired through i18n", () => {
  assert.match(readSource("components/common/terminal.tsx"), /useTranslation/)
  assert.match(readSource("hooks/useGitHubSetupCallback.ts"), /useTranslation/)

  for (const file of [
    "utils/requestUtils.ts",
    "lib/agent-resources-api.ts",
    "components/manager/skill-package.ts",
  ]) {
    assert.match(readSource(file), /@\/i18n/, file)
  }
})
