import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialogSource = readFileSync(
  new URL("../src/components/console/project/start-develop-task-dialog.tsx", import.meta.url),
  "utf8",
);

test("项目启动任务弹窗允许选择系统镜像并提交选中的镜像", () => {
  assert.match(dialogSource, /selectedImageId/);
  assert.match(dialogSource, /setSelectedImageId\(selectImage\(images, true\)\)/);
  assert.match(dialogSource, /image_id: selectedImageId/);
  assert.match(dialogSource, /<Label>\{t\("consoleProject\.startTask\.image"\)\}<\/Label>/);
  assert.match(dialogSource, /<Select value=\{selectedImageId\} onValueChange=\{setSelectedImageId\}>/);
});

test("项目启动任务弹窗把模型宿主机和系统镜像折叠到高级选项", () => {
  assert.match(dialogSource, /const \[advancedOptionsOpen, setAdvancedOptionsOpen\] = useState\(false\)/);
  assert.match(dialogSource, /<Collapsible[\s\S]*open=\{advancedOptionsOpen\}[\s\S]*onOpenChange=\{setAdvancedOptionsOpen\}/);
  assert.match(dialogSource, /t\("consoleProject\.startTask\.advancedOptions"\)/);

  const advancedContentMatch = dialogSource.match(/<CollapsibleContent[\s\S]*?<\/CollapsibleContent>/);
  assert.ok(advancedContentMatch, "advanced options content should be present");

  const advancedContent = advancedContentMatch[0];
  assert.match(advancedContent, /<Label>\{t\("consoleProject\.startTask\.model"\)\}<\/Label>/);
  assert.match(advancedContent, /<ModelSelect/);
  assert.match(advancedContent, /<Label>\{t\("consoleProject\.startTask\.host"\)\}<\/Label>/);
  assert.match(advancedContent, /<Select value=\{selectedHostId\} onValueChange=\{setSelectedHostId\}>/);
  assert.match(advancedContent, /<Label>\{t\("consoleProject\.startTask\.image"\)\}<\/Label>/);
  assert.match(advancedContent, /<Select value=\{selectedImageId\} onValueChange=\{setSelectedImageId\}>/);
});

test("项目启动任务弹窗提交前要求模型宿主机和系统镜像都有值", () => {
  assert.match(dialogSource, /if \(!selectedModelId\) \{[\s\S]*?toast\.error\(t\("consoleProject\.startTask\.toast\.modelRequired"\)\)/);
  assert.match(dialogSource, /if \(!selectedHostId\) \{[\s\S]*?toast\.error\(t\("consoleProject\.startTask\.toast\.hostRequired"\)\)/);
  assert.match(dialogSource, /if \(!selectedImageId\) \{[\s\S]*?toast\.error\(t\("consoleProject\.startTask\.toast\.imageRequired"\)\)/);
});

test("项目启动任务弹窗在高级选项里支持 Skills 并提交选中项", () => {
  assert.match(dialogSource, /type DomainSkill/);
  assert.match(dialogSource, /defaultSkills/);
  assert.match(dialogSource, /ALL_SKILLS_TAG, TaskSkillSelector/);
  assert.match(dialogSource, /filterSelectableSkillIds/);
  assert.match(dialogSource, /apiRequest\("v1SkillsList"/);
  assert.match(dialogSource, /const \[selectedSkill, setSelectedSkill\] = useState<string\[\]>\(defaultSkills\)/);
  assert.match(dialogSource, /<TaskSkillSelector/);
  assert.match(dialogSource, /selectedSkills=\{selectedSkill\}/);
  assert.match(dialogSource, /skill_ids: selectedSkill/);
});
