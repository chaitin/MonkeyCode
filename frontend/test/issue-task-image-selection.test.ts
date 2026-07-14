import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const sources = {
  shared: readSource(
    "../src/components/console/project/issue-task-dialog-shared.tsx",
  ),
  design: readSource(
    "../src/components/console/project/issue-design-dialog.tsx",
  ),
  develop: readSource("../src/components/console/project/issue-dev-dialog.tsx"),
  projectTask: readSource(
    "../src/components/console/project/start-develop-task-dialog.tsx",
  ),
  taskInput: readSource("../src/components/console/task/task-input.tsx"),
  defaultTask: readSource(
    "../src/components/console/task/create-default-task-dialog.tsx",
  ),
};

test("需求设计和开发任务共享镜像选择并优先使用项目镜像", () => {
  assert.match(sources.shared, /export function useIssueTaskImageSelection/);
  assert.match(
    sources.shared,
    /projectImageIsValid \? projectImageId : selectImage\(images, true\)/,
  );
  assert.match(
    sources.shared,
    /<Select value=\{selectedImageId\} onValueChange=\{setSelectedImageId\}>/,
  );

  for (const source of [sources.design, sources.develop]) {
    assert.match(
      source,
      /useIssueTaskImageSelection\(open, images, project\?\.image_id\)/,
    );
    assert.match(source, /<IssueTaskImageSelect/);
    assert.match(source, /if \(!selectedImageId\)/);
    assert.match(source, /image_id: selectedImageId/);
    assert.doesNotMatch(source, /selectImage\(images, false\)/);
  }
});

test("需求设计和开发任务在离线模式选择本地在线宿主机", () => {
  assert.match(sources.shared, /export function useIssueTaskHostSelection/);
  assert.match(
    sources.shared,
    /IS_OFFLINE_EDITION[\s\S]*?host\.status === ConstsHostStatus\.HostStatusOnline/,
  );
  assert.match(
    sources.shared,
    /!IS_OFFLINE_EDITION && \([\s\S]*?<SelectItem value="public_host">/,
  );

  for (const source of [sources.design, sources.develop]) {
    assert.match(
      source,
      /useIssueTaskHostSelection\(open, hosts, selectedModel\)/,
    );
    assert.match(source, /<IssueTaskHostSelect/);
    assert.match(source, /if \(!selectedHostId\)/);
    assert.match(source, /host_id: selectedHostId/);
    assert.doesNotMatch(source, /selectHost\(hosts, false\)/);
  }
});

test("所有直接创建任务的对话框都提供镜像选择", () => {
  assert.match(sources.design, /<IssueTaskImageSelect/);
  assert.match(sources.develop, /<IssueTaskImageSelect/);

  for (const source of [
    sources.projectTask,
    sources.taskInput,
    sources.defaultTask,
  ]) {
    assert.match(
      source,
      /<Select value=\{selectedImageId\} onValueChange=\{setSelectedImageId\}>/,
    );
    assert.match(source, /image_id: selectedImageId/);
  }
});

test("需求任务镜像选择提供中英文文案", () => {
  assert.equal(cn.consoleProject.issueTask.image, "系统镜像");
  assert.equal(en.consoleProject.issueTask.image, "System image");
  assert.equal(
    cn.consoleProject.issueTask.toast.imageRequired,
    "请选择系统镜像",
  );
  assert.equal(
    en.consoleProject.issueTask.toast.imageRequired,
    "Please select a system image",
  );
  assert.equal(cn.consoleProject.issueTask.toast.hostRequired, "请选择宿主机");
  assert.equal(
    en.consoleProject.issueTask.toast.hostRequired,
    "Please select a host",
  );
});

test("通用任务入口提交前校验系统镜像", () => {
  for (const source of [sources.taskInput, sources.defaultTask]) {
    assert.match(source, /if \(!selectedImageId\)/);
    assert.match(source, /t\("taskWorkflow\.toast\.missingImage"\)/);
  }

  assert.equal(cn.taskWorkflow.toast.missingImage, "请选择系统镜像");
  assert.equal(
    en.taskWorkflow.toast.missingImage,
    "Please select a system image",
  );
});
