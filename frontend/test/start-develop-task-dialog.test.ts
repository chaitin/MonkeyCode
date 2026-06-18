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
  assert.match(dialogSource, /<Label>系统镜像<\/Label>/);
  assert.match(dialogSource, /<Select value=\{selectedImageId\} onValueChange=\{setSelectedImageId\}>/);
});

test("项目启动任务弹窗把模型宿主机和系统镜像折叠到高级选项", () => {
  assert.match(dialogSource, /const \[advancedOptionsOpen, setAdvancedOptionsOpen\] = useState\(false\)/);
  assert.match(dialogSource, /<Collapsible[\s\S]*open=\{advancedOptionsOpen\}[\s\S]*onOpenChange=\{setAdvancedOptionsOpen\}/);
  assert.match(dialogSource, />高级选项</);

  const advancedContentMatch = dialogSource.match(/<CollapsibleContent[\s\S]*?<\/CollapsibleContent>/);
  assert.ok(advancedContentMatch, "advanced options content should be present");

  const advancedContent = advancedContentMatch[0];
  assert.match(advancedContent, /<Label>大模型<\/Label>/);
  assert.match(advancedContent, /<ModelSelect/);
  assert.match(advancedContent, /<Label>宿主机<\/Label>/);
  assert.match(advancedContent, /<Select value=\{selectedHostId\} onValueChange=\{setSelectedHostId\}>/);
  assert.match(advancedContent, /<Label>系统镜像<\/Label>/);
  assert.match(advancedContent, /<Select value=\{selectedImageId\} onValueChange=\{setSelectedImageId\}>/);
});

test("项目启动任务弹窗提交前要求模型宿主机和系统镜像都有值", () => {
  assert.match(dialogSource, /if \(!selectedModelId\) \{[\s\S]*?toast\.error\('请选择大模型'\)/);
  assert.match(dialogSource, /if \(!selectedHostId\) \{[\s\S]*?toast\.error\('请选择宿主机'\)/);
  assert.match(dialogSource, /if \(!selectedImageId\) \{[\s\S]*?toast\.error\('请选择系统镜像'\)/);
});
