import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  page: readSource("../src/pages/console/manager/mcp.tsx"),
  dialog: readSource("../src/components/manager/team-mcp-server-dialog.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("MCP 管理页面使用 managerMcp i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.page, /t\("managerMcp\.description"\)/);
  assert.match(sourceFiles.page, /t\("managerMcp\.actions\.add"\)/);
  assert.match(sourceFiles.page, /t\("managerMcp\.toast\.fetchServersFailed"\)/);
  assert.match(sourceFiles.dialog, /t\("managerMcp\.dialog\.addTitle"\)/);
  assert.match(sourceFiles.dialog, /t\("managerMcp\.fields\.name"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("MCP 管理页面提供中英文资源", () => {
  assert.equal(cn.managerMcp.description, "管理团队 MCP 服务器和可使用分组，同步后团队成员可按授权分组使用工具。");
  assert.equal(en.managerMcp.description, "Manage team MCP servers and allowed groups. After sync, team members can use tools according to group authorization.");
  assert.equal(cn.managerMcp.actions.add, "添加 MCP");
  assert.equal(en.managerMcp.actions.add, "Add MCP");
  assert.equal(cn.managerMcp.dialog.addTitle, "添加团队 MCP 服务器");
  assert.equal(en.managerMcp.dialog.addTitle, "Add team MCP server");
});
