import assert from "node:assert/strict"
import test from "node:test"

import { getSiteRedirectPrompt, getSiteRedirectUrl, languagesContainChinese } from "../src/site-redirect.ts"

function location(hostname: string) {
  return {
    hostname,
    pathname: "/login",
    search: "?next=%2Fconsole%2Ftasks",
    hash: "#section",
  }
}

test("国际站语言链前两项包含中文时跳转到中文站并保留路径", () => {
  assert.equal(
    getSiteRedirectUrl(location("monkeycode-ai.net"), ["en-US", "zh-CN", "ja-JP"]),
    "https://monkeycode-ai.com/login?next=%2Fconsole%2Ftasks#section",
  )
})

test("国际站语言链前两项包含中文时返回区域切换提示信息", () => {
  assert.deepEqual(
    getSiteRedirectPrompt(location("monkeycode-ai.net"), [" en-US ", "zh-CN", "ja-JP"]),
    {
      currentHost: "monkeycode-ai.net",
      currentRegion: "global",
      targetHost: "monkeycode-ai.com",
      targetRegion: "cn",
      targetUrl: "https://monkeycode-ai.com/login?next=%2Fconsole%2Ftasks#section",
      detectedLanguages: ["en-US", "zh-CN", "ja-JP"],
    },
  )
})

test("中文站语言链前两项不包含中文时跳转到国际站并保留路径", () => {
  assert.equal(
    getSiteRedirectUrl(location("monkeycode-ai.com"), ["en-US", "ja-JP"]),
    "https://monkeycode-ai.net/login?next=%2Fconsole%2Ftasks#section",
  )
})

test("已经在匹配站点时不跳转", () => {
  assert.equal(getSiteRedirectUrl(location("monkeycode-ai.com"), ["zh-CN"]), null)
  assert.equal(getSiteRedirectUrl(location("monkeycode-ai.net"), ["en-US"]), null)
})

test("localhost 中文浏览器环境按中文版返回区域切换提示信息", () => {
  assert.deepEqual(
    getSiteRedirectPrompt(location("localhost"), ["zh-CN"]),
    {
      currentHost: "localhost",
      currentRegion: "cn",
      targetHost: "monkeycode-ai.net",
      targetRegion: "global",
      targetUrl: "https://monkeycode-ai.net/login?next=%2Fconsole%2Ftasks#section",
      detectedLanguages: ["zh-CN"],
    },
  )
})

test("localhost 非中文浏览器环境按国际版返回区域切换提示信息", () => {
  assert.deepEqual(
    getSiteRedirectPrompt(location("localhost"), ["en-US"]),
    {
      currentHost: "localhost",
      currentRegion: "global",
      targetHost: "monkeycode-ai.com",
      targetRegion: "cn",
      targetUrl: "https://monkeycode-ai.com/login?next=%2Fconsole%2Ftasks#section",
      detectedLanguages: ["en-US"],
    },
  )
})

test("无关域名不跳转", () => {
  assert.equal(getSiteRedirectUrl(location("example.com"), ["zh-CN"]), null)
})

test("语言链只检查前两项", () => {
  assert.equal(languagesContainChinese(["en-US", "ja-JP", "zh-CN"]), false)
})
