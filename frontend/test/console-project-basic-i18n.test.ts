import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  addProject: readSource("../src/components/console/project/add-project.tsx"),
  editName: readSource("../src/components/console/project/edit-project-name.tsx"),
  editEnv: readSource("../src/components/console/project/edit-project-env.tsx"),
  editImage: readSource("../src/components/console/project/edit-project-image.tsx"),
  autoReview: readSource("../src/components/console/project/auto-review-dialog.tsx"),
  projectInfo: readSource("../src/components/console/project/project-info.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目基础组件使用 consoleProject i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.addProject, /t\("consoleProject\.create\.title"\)/);
  assert.match(sourceFiles.editName, /t\("consoleProject\.editName\.title"\)/);
  assert.match(sourceFiles.editEnv, /t\("consoleProject\.env\.title"\)/);
  assert.match(sourceFiles.editImage, /t\("consoleProject\.image\.title"\)/);
  assert.match(sourceFiles.autoReview, /t\("consoleProject\.autoReview\.title"\)/);
  assert.match(sourceFiles.projectInfo, /t\("consoleProject\.info\.startAi"\)/);
  assert.match(sourceFiles.projectInfo, /t\("consoleProject\.delete\.description"/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("项目基础组件提供中英文资源", () => {
  assert.equal(cn.consoleProject.create.title, "创建项目");
  assert.equal(en.consoleProject.create.title, "Create project");
  assert.equal(cn.consoleProject.info.startAi, "启动 AI");
  assert.equal(en.consoleProject.info.startAi, "Start AI");
  assert.equal(cn.consoleProject.delete.description, "确定要删除项目 \"{{name}}\" 吗？此操作不可撤销，项目内的所有数据都将被删除。");
  assert.equal(en.consoleProject.delete.description, "Delete project \"{{name}}\"? This action cannot be undone and all data in the project will be deleted.");
});
