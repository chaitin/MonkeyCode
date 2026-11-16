import assert from "node:assert/strict"
import { test } from "node:test"
import { designSummary, sectionDigests, successfulSections, defaultSections } from "../src/lib/design-import.ts"

test("四类设计统计使用源快照身份", () => {
  const summary = designSummary({ design: { plan_digest: "design-plan", design: { publisher_id: "publisher", release_id: "release", schema_version: 1, counts: { template: 2, "design-system": 3, style: 4, direction: 5 }, changes: [] } } })
  assert.equal(summary.release_id, "release")
  assert.deepEqual(summary.counts, { template: 2, "design-system": 3, style: 4, direction: 5 })
  assert.equal(designSummary({ agent: { plan_digest: "agent-plan" } }), null)
})

test("未支持和失败分区不算成功", () => {
  assert.deepEqual(defaultSections({ available_sections: ["agent", "design"], sections: { agent: { present: true, supported: true }, design: { present: true, supported: false } } }), ["agent"])
  assert.equal(successfulSections({ status: "partial", sections: { agent: { status: "succeeded", replayed: false }, design: { status: "failed", replayed: false } } }), false)
  assert.equal(successfulSections({ status: "succeeded", sections: { design: { status: "succeeded", replayed: false } } }), true)
})

test("确认请求使用各分区计划", () => {
  assert.deepEqual(sectionDigests({ agent: { plan_digest: "a" }, design: { plan_digest: "d" } }), { agent: "a", design: "d" })
  assert.equal(successfulSections({ status: "succeeded", sections: {} }), false)
})

test("知识库分区可选择、确认且独立返回导入结果", () => {
  const discovery = { available_sections: ["knowledge"], sections: { knowledge: { present: true, supported: true, schema_version: 1 } } }
  assert.deepEqual(defaultSections(discovery), ["knowledge"])
  assert.deepEqual(sectionDigests({ knowledge: { plan_digest: "kb-plan", knowledge: { publisher_id: "wiki", release_id: "r1", changes: [{ slug: "kb", name: "文档", action: "create", documents: 32, folders: 3 }] } } }), { knowledge: "kb-plan" })
  assert.equal(successfulSections({ status: "succeeded", sections: { knowledge: { status: "succeeded", replayed: false } } }), true)
  assert.equal(successfulSections({ status: "partial", sections: { agent: { status: "succeeded", replayed: false }, knowledge: { status: "failed", replayed: false } } }), false)
})
