import assert from "node:assert/strict"
import test from "node:test"

import { getSiteRedirectUrl, languagesContainChinese } from "../src/site-redirect.ts"

function location(hostname: string) {
  return {
    hostname,
    pathname: "/login",
    search: "?next=%2Fconsole%2Ftasks",
    hash: "#section",
  }
}

test("国际站语言链前四项包含中文时跳转到中文站并保留路径", () => {
  assert.equal(
    getSiteRedirectUrl(location("monkeycode-ai.net"), ["en-US", "ja-JP", "zh-CN"]),
    "https://monkeycode-ai.com/login?next=%2Fconsole%2Ftasks#section",
  )
})

test("中文站语言链前四项不包含中文时跳转到国际站并保留路径", () => {
  assert.equal(
    getSiteRedirectUrl(location("monkeycode-ai.com"), ["en-US", "ja-JP"]),
    "https://monkeycode-ai.net/login?next=%2Fconsole%2Ftasks#section",
  )
})

test("已经在匹配站点时不跳转", () => {
  assert.equal(getSiteRedirectUrl(location("monkeycode-ai.com"), ["zh-CN"]), null)
  assert.equal(getSiteRedirectUrl(location("monkeycode-ai.net"), ["en-US"]), null)
})

test("非正式域名不跳转", () => {
  assert.equal(getSiteRedirectUrl(location("localhost"), ["zh-CN"]), null)
})

test("语言链只检查前四项", () => {
  assert.equal(languagesContainChinese(["en-US", "ja-JP", "fr-FR", "ko-KR", "zh-CN"]), false)
})
