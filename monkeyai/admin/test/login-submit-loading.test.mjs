import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("login submit keeps its label and shows a spinner while disabled", async () => {
  const source = await readFile(
    new URL("../src/components/email-auth-form.tsx", import.meta.url),
    "utf8"
  )
  const submit = source.split('type="submit"')[1]?.split("</Button>")[0]
  assert.ok(submit)
  assert.match(source, /const locked = disabled \|\| busy \|\| sending/)
  assert.match(submit, /disabled=\{locked\}/)
  assert.match(submit, /aria-busy=\{busy\}/)
  assert.match(submit, /busy && \(\s*<HugeiconsIcon\s+icon=\{Loading03Icon\}/)
  assert.match(submit, /animate-spin motion-reduce:animate-none/)
  assert.match(submit, /\{title\}/)
  assert.doesNotMatch(submit, /busy \? `\$\{title\}…` : title/)
})

test("email verification button uses ghost styling", async () => {
  const source = await readFile(
    new URL("../src/components/email-auth-form.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    source,
    /<Button\s+variant="ghost"\s+size="sm"\s+type="button"\s+className="h-7 px-2 text-xs"\s+disabled=\{remaining > 0 \|\| !email\.trim\(\)\}/
  )
})
