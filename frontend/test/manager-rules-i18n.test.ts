import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import cn from "../src/i18n/resources/cn.ts"
import en from "../src/i18n/resources/en.ts"

const source = readFileSync(
  new URL("../src/pages/console/manager/rules.tsx", import.meta.url),
  "utf8",
)
const navSource = readFileSync(
  new URL("../src/components/manager/nav-teams.tsx", import.meta.url),
  "utf8",
)
const cjkPattern = /[\u3400-\u9fff]/

test("全局规范管理页使用 managerRules i18n，403 不渲染成空列表", () => {
  assert.match(source, /useTranslation/)
  assert.match(source, /t\("managerRules\.empty\.forbiddenTitle"\)/)
  assert.match(source, /t\("managerRules\.empty\.forbiddenDescription"\)/)
  assert.match(source, /setForbidden\(true\)/)
  assert.match(source, /error instanceof Response/)
  assert.match(source, /status === 403/)
  assert.doesNotMatch(source, cjkPattern)
  assert.doesNotMatch(navSource, cjkPattern)
  assert.match(navSource, /canManageRules/)
  assert.match(navSource, /v1TeamsRulesList/)
})

test("全局规范无权限态提供中英文资源", () => {
  assert.equal(cn.managerRules.empty.forbiddenTitle, "无权限查看全局规范")
  assert.equal(
    en.managerRules.empty.forbiddenTitle,
    "No permission to view global rules",
  )
  assert.equal(
    cn.managerRules.empty.forbiddenDescription,
    "仅管理员可以管理企业级全局规范，普通成员不能查看正文。",
  )
  assert.equal(
    en.managerRules.empty.forbiddenDescription,
    "Only administrators can manage enterprise global rules. Members cannot view rule content.",
  )
  assert.notEqual(cn.managerRules.empty.forbiddenTitle, cn.managerRules.empty.title)
  assert.notEqual(en.managerRules.empty.forbiddenTitle, en.managerRules.empty.title)
})
