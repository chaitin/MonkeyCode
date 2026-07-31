import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  taskInput: readSource("../src/components/console/task/task-input.tsx"),
  taskActions: readSource("../src/components/console/task/task-actions-dropdown.tsx"),
  modelSelect: readSource("../src/components/console/task/model-select.tsx"),
  skillSelector: readSource("../src/components/console/task/task-skill-selector.tsx"),
  pluginSelector: readSource("../src/components/console/task/task-plugin-selector.tsx"),
  concurrentLimit: readSource("../src/components/console/task/task-concurrent-limit-dialog.tsx"),
  voiceInput: readSource("../src/components/console/task/voice-input-button.tsx"),
  createDefaultTaskDialog: readSource("../src/components/console/task/create-default-task-dialog.tsx"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("任务工作流共享组件使用 taskWorkflow i18n key", () => {
  assert.match(sourceFiles.taskInput, /useTranslation/);
  assert.match(sourceFiles.taskInput, /t\("taskWorkflow\.input\.placeholder"\)/);
  assert.match(sourceFiles.taskInput, /t\("taskWorkflow\.repo\.myRepositories"\)/);
  assert.match(sourceFiles.taskInput, /t\("taskWorkflow\.dialog\.params\.title"\)/);
  assert.match(sourceFiles.taskInput, /t\("taskWorkflow\.toast\.taskStarted"\)/);
  assert.match(sourceFiles.taskInput, /overCount:/);

  assert.match(sourceFiles.taskActions, /t\("taskWorkflow\.actions\.rename"\)/);
  assert.match(sourceFiles.taskActions, /t\("taskWorkflow\.actions\.stop"\)/);
  assert.match(sourceFiles.taskActions, /t\("taskWorkflow\.actions\.delete"\)/);
  assert.match(sourceFiles.taskActions, /t\("taskWorkflow\.rename\.title"\)/);

  assert.match(sourceFiles.modelSelect, /t\("taskWorkflow\.model\.basic"\)/);
  assert.match(sourceFiles.modelSelect, /t\("taskWorkflow\.model\.recommended"\)/);

  assert.match(sourceFiles.skillSelector, /t\("taskWorkflow\.skill\.label"\)/);
  assert.match(sourceFiles.pluginSelector, /t\("taskWorkflow\.plugin\.empty"\)/);
  assert.match(sourceFiles.concurrentLimit, /t\("taskWorkflow\.concurrentLimit\.title"\)/);
  assert.match(sourceFiles.voiceInput, /t\("taskWorkflow\.voice\.recording"\)/);

  assert.match(sourceFiles.createDefaultTaskDialog, /useTranslation/);
  assert.match(sourceFiles.createDefaultTaskDialog, /ALL_SKILLS_TAG/);
  assert.match(sourceFiles.createDefaultTaskDialog, /t\("taskWorkflow\.dialog\.create\.title"\)/);
  assert.match(sourceFiles.createDefaultTaskDialog, /t\("taskWorkflow\.dialog\.params\.advancedOptions"\)/);
  assert.match(sourceFiles.createDefaultTaskDialog, /t\("taskWorkflow\.toast\.zipSelected"\)/);
});

test("任务工作流共享组件提供中英文资源", () => {
  assert.equal(cn.taskWorkflow.input.execute, "执行");
  assert.equal(en.taskWorkflow.input.execute, "Run");
  assert.equal(cn.taskWorkflow.repo.myRepositories, "我的仓库");
  assert.equal(en.taskWorkflow.repo.myRepositories, "My repositories");
  assert.equal(cn.taskWorkflow.model.basic, "基础模型");
  assert.equal(en.taskWorkflow.model.basic, "Basic model");
  assert.equal(cn.taskWorkflow.concurrentLimit.title, "并发任务数已达上限");
  assert.equal(en.taskWorkflow.concurrentLimit.title, "Concurrent task limit reached");
  assert.equal(cn.taskWorkflow.voice.recording, "正在录音");
  assert.equal(en.taskWorkflow.voice.recording, "Recording");
  assert.equal(cn.taskWorkflow.dialog.create.title, "创建任务");
  assert.equal(en.taskWorkflow.dialog.create.title, "Create task");
  assert.equal(cn.taskWorkflow.dialog.params.advancedOptions, "高级选项");
  assert.equal(en.taskWorkflow.dialog.params.advancedOptions, "Advanced options");
  assert.equal(cn.taskWorkflow.actions.stop, "终止任务");
  assert.equal(en.taskWorkflow.actions.stop, "Stop");
  assert.equal(cn.taskWorkflow.actions.delete, "删除任务");
  assert.equal(en.taskWorkflow.actions.delete, "Delete");
});

test("模型选择框推荐标按同级别模型 weight 计算", () => {
  assert.match(sourceFiles.modelSelect, /recommendedModelKeys/);
  assert.match(sourceFiles.modelSelect, /getBuiltinModelName\(model\.model\) === option\.model/);
  assert.match(sourceFiles.modelSelect, /\(right\.weight \|\| 0\) - \(left\.weight \|\| 0\)/);
  assert.doesNotMatch(sourceFiles.modelSelect, /qwen3\.5-plus|qwen3\.6-plus|gpt-5\.5/);
});
