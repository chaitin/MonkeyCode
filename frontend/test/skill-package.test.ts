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

test("允许无 frontmatter 的 SKILL.md 由用户手动填写元数据", () => {
  const content = `# 自定义 Skill

这里是 Skill 正文。
`;

  const parsed = parseSkillMarkdown(content);

  assert.equal(parsed.name, "");
  assert.equal(parsed.description, "");
  assert.deepEqual(parsed.tags, []);
  assert.equal(parsed.content, content);
  assert.equal(parsed.body, content);
});

test("frontmatter 缺少部分元数据时保留已解析字段并留空缺失字段", () => {
  const content = `---
name: 只有名称
tags:
  - 测试
---

# 正文
`;

  const parsed = parseSkillMarkdown(content);

  assert.equal(parsed.name, "只有名称");
  assert.equal(parsed.description, "");
  assert.deepEqual(parsed.tags, ["测试"]);
  assert.equal(parsed.content, content);
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
