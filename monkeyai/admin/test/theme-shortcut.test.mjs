import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("theme provider does not register a single-key theme shortcut", async () => {
  const source = await readFile(
    new URL("../src/components/theme-provider.tsx", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /addEventListener\("keydown"/)
  assert.doesNotMatch(source, /event\.key\.toLowerCase\(\) !== "d"/)
})
