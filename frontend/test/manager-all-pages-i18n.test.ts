import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const roots = [
  fileURLToPath(new URL("../src/pages/console/manager", import.meta.url)),
  fileURLToPath(new URL("../src/components/manager", import.meta.url)),
]

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : []
  })
}

test("管理后台所有页面和组件不包含硬编码中文 label", () => {
  for (const path of roots.flatMap(sourceFiles)) {
    const source = readFileSync(path, "utf8")
    assert.doesNotMatch(source, /[\u3400-\u9fff]/, `${path} contains hard-coded Chinese`)
  }
})

test("管理后台统一挂载可持久化语言切换入口", () => {
  const shell = readFileSync(
    new URL("../src/pages/console/manager/page.tsx", import.meta.url),
    "utf8",
  )
  const toggle = readFileSync(
    new URL("../src/components/language-toggle.tsx", import.meta.url),
    "utf8",
  )
  const i18n = readFileSync(new URL("../src/i18n/index.ts", import.meta.url), "utf8")

  assert.match(shell, /<LanguageToggle \/>/)
  assert.match(toggle, /DropdownMenuRadioGroup/)
  assert.match(toggle, /common\.language\.cn/)
  assert.match(toggle, /common\.language\.en/)
  assert.match(i18n, /applyLanguage\(language\)/)
})
