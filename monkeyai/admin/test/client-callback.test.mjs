import assert from "node:assert/strict"
import test from "node:test"
import { isSafeClientLaunchURL } from "../src/lib/client-callback.ts"

for (const [client, redirect] of [
  ["monkeyai-desktop", "monkeyai-desktop://oauth/callback"],
  ["monkeyai-mobile", "monkeyai-mobile://oauth/callback"],
  ["monkeyai-desktop", "http://127.0.0.1:54321/oauth/callback"],
  ["monkeyai-desktop", "http://[::1]:54321/oauth/callback"],
  ["monkeyai-desktop", "http://127.0.0.1:80/oauth/callback"],
  ["monkeyai-desktop", "http://localhost:54321/oauth/callback"],
  ["monkeyai-desktop", "http://localhost:80/oauth/callback"],
]) {
  test(`authorization launch stays bound to ${redirect}`, () => {
    assert.equal(
      isSafeClientLaunchURL(
        client,
        redirect,
        `${redirect}?code=one-time-code&state=client-state`
      ),
      true
    )
    for (const launch of [
      "https://oauth-audit.invalid/callback?code=code&state=state",
      "javascript:alert(1)//?code=code&state=state",
      "data:text/html,test?code=code&state=state",
      "//attacker.example/callback?code=code&state=state",
      "monkeyai-desktop://other/callback?code=code&state=state",
      `${redirect}?code=code&state=state#fragment`,
      `${redirect}?code=code&state=state&next=https://attacker.example`,
      `${redirect}?code=first&code=second&state=state`,
      `${redirect}?code=code&state=first&state=second`,
      `${redirect}?code=&state=state`,
      `${redirect}?code=code&state=`,
      redirect,
    ])
      assert.equal(
        isSafeClientLaunchURL(client, redirect, launch),
        false,
        launch
      )
  })
}

test("unregistered destinations and clients cannot authorize a manual launch link", () => {
  for (const redirect of [
    "https://oauth-audit.invalid/callback",
    "http://localhost.attacker.example:54321/oauth/callback",
    "http://localhost@attacker.example:54321/oauth/callback",
    "http://attacker@localhost:54321/oauth/callback",
    "http://localhost/oauth/callback",
    "http://localhost:0/oauth/callback",
    "http://localhost:65536/oauth/callback",
    "http://localhost:05432/oauth/callback",
    "https://localhost:54321/oauth/callback",
    "http://localhost:54321/other",
    "http://localhost:54321/oauth/%63allback",
    "http://localhost:54321/oauth/callback?next=external",
    "http://localhost:54321/oauth/callback#fragment",
    "http://127.0.0.1.attacker.example:54321/oauth/callback",
    "http://127.0.0.1@attacker.example:54321/oauth/callback",
    "http://attacker@127.0.0.1:54321/oauth/callback",
    "http://127.0.0.1/oauth/callback",
    "http://127.0.0.1:0/oauth/callback",
    "http://127.0.0.1:65536/oauth/callback",
    "http://127.0.0.1:05432/oauth/callback",
    "http://127.0.0.1:54321/other",
    "http://127.0.0.1:54321/oauth/%63allback",
    "http://127.0.0.1:54321/oauth/callback?",
    "http://127.0.0.1:54321/oauth/callback#",
  ])
    assert.equal(
      isSafeClientLaunchURL(
        "monkeyai-desktop",
        redirect,
        `${redirect}?code=code&state=state`
      ),
      false,
      redirect
    )
  assert.equal(
    isSafeClientLaunchURL(
      "monkeyai-mobile",
      "http://127.0.0.1:54321/oauth/callback",
      "http://127.0.0.1:54321/oauth/callback?code=code&state=state"
    ),
    false
  )
  assert.equal(
    isSafeClientLaunchURL(
      "monkeyai-mobile",
      "http://localhost:54321/oauth/callback",
      "http://localhost:54321/oauth/callback?code=code&state=state"
    ),
    false
  )
  assert.equal(
    isSafeClientLaunchURL(
      "monkeyai-desktop",
      "http://localhost:54321/oauth/callback",
      "http://127.0.0.1:54321/oauth/callback?code=code&state=state"
    ),
    false
  )
  assert.equal(
    isSafeClientLaunchURL(
      "unknown",
      "monkeyai-desktop://oauth/callback",
      "monkeyai-desktop://oauth/callback?code=code&state=state"
    ),
    false
  )
  assert.equal(
    isSafeClientLaunchURL(
      "monkeyai-desktop",
      "http://127.0.0.1:54321/oauth/callback",
      "http://127.0.0.1:54322/oauth/callback?code=code&state=state"
    ),
    false
  )
})
