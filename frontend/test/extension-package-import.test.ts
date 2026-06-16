import assert from "node:assert/strict";
import test from "node:test";

import { formatExtensionImportResult } from "../src/pages/console/manager/extension-package.ts";

test("格式化扩展包导入结果", () => {
  assert.equal(
    formatExtensionImportResult({
      created_skills: 1,
      updated_skills: 2,
      created_images: 3,
      updated_images: 4,
    }),
    "新增 1 个 Skills，更新 2 个 Skills，新增 3 个镜像，更新 4 个镜像",
  );
});

test("格式化扩展包导入结果时缺省计数按 0 处理", () => {
  assert.equal(
    formatExtensionImportResult({}),
    "新增 0 个 Skills，更新 0 个 Skills，新增 0 个镜像，更新 0 个镜像",
  );
});
