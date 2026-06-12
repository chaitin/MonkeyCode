import assert from "node:assert/strict";
import test from "node:test";

import {
  findSkillMarkdownPath,
  normalizeSkillTags,
  parseSkillMarkdown,
} from "../src/components/manager/skill-package.ts";

const skillMarkdown = `---
name: 设计系统模式
description: 使用设计令牌、主题基础设施和组件架构模式构建可扩展的设计系统。
tags: ["前端", "设计", "前端"]
---

# 设计系统模式

使用这些说明构建设计系统。
`;

test("解析 SKILL.md frontmatter 生成可确认的 Skill 表单草稿", () => {
  const parsed = parseSkillMarkdown(skillMarkdown);

  assert.equal(parsed.name, "设计系统模式");
  assert.equal(parsed.description, "使用设计令牌、主题基础设施和组件架构模式构建可扩展的设计系统。");
  assert.deepEqual(parsed.tags, ["前端", "设计"]);
  assert.equal(parsed.content, skillMarkdown);
});

test("标签输入支持数组、逗号字符串并去重", () => {
  assert.deepEqual(normalizeSkillTags(["前端", "设计", "前端", " "]), ["前端", "设计"]);
  assert.deepEqual(normalizeSkillTags("前端, 设计，测试\n开发"), ["前端", "设计", "测试", "开发"]);
});

test("zip 包路径列表优先选择最短的 SKILL.md", () => {
  assert.equal(
    findSkillMarkdownPath([
      "design-system/references/token.md",
      "design-system/SKILL.md",
      "design-system/nested/SKILL.md",
    ]),
    "design-system/SKILL.md",
  );
});
