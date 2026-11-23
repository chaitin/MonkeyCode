import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../src/", import.meta.url)

test("session statistics purge requires a root session and exact ID confirmation", async () => {
  const page = await readFile(new URL("pages/admin/session-detail-page.tsx", root), "utf8")
  assert.match(page, /!data\.parent_session_id/)
  assert.match(page, /confirmID !== sessionId/)
  assert.match(page, /"X-Confirm-Session-ID": sessionId/)
  assert.match(page, /method: "DELETE"/)
  assert.match(page, /<AlertDialog/)
})
