import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  createIssue: readSource("../src/components/console/project/create-issue.tsx"),
  issueList: readSource("../src/components/console/project/issue-list.tsx"),
  issueCard: readSource("../src/components/console/project/issue-card.tsx"),
  issueMenu: readSource("../src/components/console/project/issue-menu.tsx"),
  issueDetail: readSource("../src/components/console/project/issue-detail.tsx"),
  issueTaskShared: readSource("../src/components/console/project/issue-task-dialog-shared.tsx"),
  issueDesign: readSource("../src/components/console/project/issue-design-dialog.tsx"),
  issueDevelop: readSource("../src/components/console/project/issue-dev-dialog.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("项目需求组件使用 consoleProject i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.createIssue, /t\("consoleProject\.issue\.create\.title"\)/);
  assert.match(sourceFiles.issueList, /t\("consoleProject\.issue\.emptyTitle"\)/);
  assert.match(sourceFiles.issueCard, /t\("consoleProject\.issue\.priority\.high"\)/);
  assert.match(sourceFiles.issueMenu, /t\("consoleProject\.issue\.delete\.description"/);
  assert.match(sourceFiles.issueDetail, /t\("consoleProject\.issue\.detail\.requirement"\)/);
  assert.match(sourceFiles.issueTaskShared, /t\("consoleProject\.issueTask\.branch"\)/);
  assert.match(sourceFiles.issueDesign, /t\("consoleProject\.issueTask\.design\.promptTitle"/);
  assert.match(sourceFiles.issueDevelop, /t\("consoleProject\.issueTask\.develop\.promptTitle"/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("项目需求组件提供中英文资源", () => {
  assert.equal(cn.consoleProject.issue.create.title, "创建需求");
  assert.equal(en.consoleProject.issue.create.title, "Create issue");
  assert.equal(cn.consoleProject.issue.detail.requirement, "原始需求");
  assert.equal(en.consoleProject.issue.detail.requirement, "Requirement");
  assert.equal(cn.consoleProject.issueTask.design.title, "设计任务 (AI)");
  assert.equal(en.consoleProject.issueTask.design.title, "Design task (AI)");
  assert.equal(cn.consoleProject.issueTask.develop.start, "开始开发");
  assert.equal(en.consoleProject.issueTask.develop.start, "Start development");
});
