import assert from "node:assert/strict"
import test from "node:test"

import { memberIconColor } from "../src/lib/member-appearance.ts"

test("member icon colors align across tree and list, with disabled status taking priority", () => {
  assert.equal(
    memberIconColor({ role: "user", status: "active" }),
    "text-blue-600 dark:text-blue-400"
  )
  assert.equal(
    memberIconColor({ role: "admin", status: "active" }),
    "text-green-700 dark:text-green-400"
  )
  assert.equal(
    memberIconColor({ role: "user", status: "disabled" }),
    "text-muted-foreground"
  )
  assert.equal(
    memberIconColor({ role: "admin", status: "disabled" }),
    "text-muted-foreground"
  )
})
