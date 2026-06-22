import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  fileManager: readSource("../src/pages/console/user/file-manager.tsx"),
  createFolder: readSource("../src/components/console/files/create-folder.tsx"),
  createFile: readSource("../src/components/console/files/create-file.tsx"),
  copy: readSource("../src/components/console/files/copy.tsx"),
  move: readSource("../src/components/console/files/move.tsx"),
  uploadFile: readSource("../src/components/console/files/upload-file.tsx"),
  editor: readSource("../src/components/console/files/editor.tsx"),
  filePicker: readSource("../src/components/console/files/file-picker-dialog.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("文件管理页面和弹窗使用 consoleFiles i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleFiles\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.fileManager, /t\("consoleFiles\.actions\.parentDirectory"\)/);
  assert.match(sourceFiles.fileManager, /t\("consoleFiles\.dialog\.deleteDescription"/);
  assert.match(sourceFiles.filePicker, /t\("consoleFiles\.picker\.title"\)/);
});

test("文件管理提供中英文资源", () => {
  assert.equal(cn.consoleFiles.actions.createFolder, "创建文件夹");
  assert.equal(en.consoleFiles.actions.createFolder, "Create folder");
  assert.equal(cn.consoleFiles.table.modifiedAt, "修改时间");
  assert.equal(en.consoleFiles.table.modifiedAt, "Modified");
  assert.equal(cn.consoleFiles.picker.title, "选择产出物");
  assert.equal(en.consoleFiles.picker.title, "Select artifacts");
});
