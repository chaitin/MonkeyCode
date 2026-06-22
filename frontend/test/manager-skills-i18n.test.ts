import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  skills: readSource("../src/pages/console/manager/skills.tsx"),
  extensionPackage: readSource("../src/pages/console/manager/extension-package.ts"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Skills 管理页面使用 managerSkills i18n key", () => {
  assert.match(sourceFiles.skills, /useTranslation/);
  assert.match(sourceFiles.skills, /t\("managerSkills\.description"\)/);
  assert.match(sourceFiles.skills, /t\("managerSkills\.actions\.add"\)/);
  assert.match(sourceFiles.skills, /t\("managerSkills\.dialogs\.delete\.description"/);
  assert.match(sourceFiles.skills, /t\("managerSkills\.parse\.readingZipMissing"\)/);
  assert.match(sourceFiles.extensionPackage, /managerSkills\.extensionImport\.summary/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("Skills 管理页面提供中英文资源", () => {
  assert.equal(cn.managerSkills.description, "管理团队可用 Skills、标签、说明和可使用分组。");
  assert.equal(en.managerSkills.description, "Manage team Skills, tags, descriptions, and allowed groups.");
  assert.equal(cn.managerSkills.actions.add, "添加 Skill");
  assert.equal(en.managerSkills.actions.add, "Add Skill");
  assert.equal(cn.managerSkills.parse.readingZipMissing, "zip 包中未找到 SKILL.md");
  assert.equal(en.managerSkills.parse.readingZipMissing, "No SKILL.md was found in the zip package");
});
