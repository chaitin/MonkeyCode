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

test("SSO submit keeps the provider name and animates a loading icon", async () => {
  const source = await readFile(
    new URL("../src/components/login-form.tsx", import.meta.url),
    "utf8"
  )
  const ssoButtons = source
    .split("{providers.map((provider) => (")[1]
    .split("</Field>")[0]

  assert.match(ssoButtons, /aria-busy=\{oauthSubmitting === provider\.id\}/)
  assert.match(
    ssoButtons,
    /oauthSubmitting === provider\.id\s*\? Loading03Icon\s*: LockKeyIcon/
  )
  assert.match(
    ssoButtons,
    /oauthSubmitting === provider\.id\s*\? "animate-spin motion-reduce:animate-none"/
  )
  assert.match(
    ssoButtons,
    /<span className="truncate">\{provider\.name\}<\/span>/
  )
  assert.doesNotMatch(ssoButtons, /`\$\{provider\.name\}…`/)
})

test("email verification button keeps its label and animates a loading icon", async () => {
  const source = await readFile(
    new URL("../src/components/email-auth-form.tsx", import.meta.url),
    "utf8"
  )
  assert.match(
    source,
    /<Button\s+variant="ghost"\s+size="sm"\s+type="button"\s+className="h-7 px-2 text-xs"\s+disabled=\{remaining > 0 \|\| !email\.trim\(\)\}/
  )
  const sendCodeButton = source
    .split("onClick={() => void sendCode()}")[1]
    .split("</Button>")[0]
  assert.match(sendCodeButton, /sending && \(\s*<HugeiconsIcon/)
  assert.match(sendCodeButton, /icon=\{Loading03Icon\}/)
  assert.match(sendCodeButton, /animate-spin motion-reduce:animate-none/)
  assert.match(sendCodeButton, /t\("login\.sendCode", "发送验证码"\)/)
  assert.doesNotMatch(sendCodeButton, /login\.sendingCode|发送中/)
})
