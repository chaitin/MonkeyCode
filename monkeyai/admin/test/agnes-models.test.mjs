import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Agnes models are available in the model management selectors", async () => {
  const source = await readFile(new URL("../src/pages/models-page.tsx", import.meta.url), "utf8")
  assert.match(source, /Agnes Image 2\.5 Flash/)
  assert.match(source, /Agnes Video 2\.5/)
  assert.match(source, /agnes-video-2\.5/)
  assert.match(source, /value: "agnes"/)
})
