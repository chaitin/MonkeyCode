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

test("billing entries preserve existing rounding and exact environment credits", async () => {
  const source = await readFile(
    new URL("../src/pages/admin/billing-details-page.tsx", import.meta.url),
    "utf8"
  )
  assert.match(source, /=>\s*credits\(value, locale, 0\)/)
  assert.match(source, /credits\(value, locale, 1, "expand"\)/)
  assert.match(source, /credits\(value, locale, 0, "floor"\)/)
  assert.equal(credits("-0.000001", "en-US"), "-0.000001")
  assert.equal(credits("256000000000.000256", "en-US"), "256,000,000,000.000256")
  assert.match(source, /changedCredits\(e\.credit_delta, i18n\.language\)/)
  assert.match(source, /balanceCredits\(e\.balance_after, i18n\.language\)/)
  assert.match(source, /billingCredits\(tx\.reserve, i18n\.language\)/)
  assert.match(source, /e\.credit_delta\.startsWith\("-"\)/)
  assert.match(source, /onClick=\{\(\) => setSelected\(e\.transaction_id\)\}/)
  assert.match(source, /requestParams\.delete\("mode"\)/)
  assert.doesNotMatch(
    source,
    /draft\.mode|aria-label="计费模式"|<TableHead>模式/
  )
})
