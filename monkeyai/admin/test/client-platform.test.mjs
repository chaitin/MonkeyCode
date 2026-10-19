import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("客户端平台筛选允许自由输入而非固定枚举", () => {
  const page = readFileSync(
    new URL("../src/pages/client-analysis-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    page,
    /visibleFields\.has\("platform"\)\s*&&\s*\(\s*<Input[\s\S]*?value=\{draft\.platform \?\? ""\}/
  )
  assert.doesNotMatch(page, /platform:\s*\[/)
})

test("自定义平台名称不会误用对象原型属性作为展示标签", () => {
  const cards = readFileSync(
    new URL("../src/components/client-distribution-cards.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    cards,
    /Object\.hasOwn\(platformLabels, value\)\s*\? platformLabels\[value\]\s*: value/
  )
})
