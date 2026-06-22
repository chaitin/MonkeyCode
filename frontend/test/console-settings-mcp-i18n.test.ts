import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  toolsMcp: readSource("../src/components/console/settings/tools-mcp.tsx"),
  addMcpServerDialog: readSource("../src/components/console/settings/add-mcp-server-dialog.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("设置 MCP 页面使用 consoleSettings mcp i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleSettings\.mcp\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.toolsMcp, /t\("consoleSettings\.mcp\.title"\)/);
  assert.match(sourceFiles.addMcpServerDialog, /t\("consoleSettings\.mcp\.dialog\.addTitle"\)/);
});

test("设置 MCP 页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.mcp.title, "MCP 与工具");
  assert.equal(en.consoleSettings.mcp.title, "MCP and tools");
  assert.equal(cn.consoleSettings.mcp.actions.add, "添加");
  assert.equal(en.consoleSettings.mcp.actions.add, "Add");
  assert.equal(cn.consoleSettings.mcp.delete.description, "确定要删除 MCP 服务器 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.mcp.delete.description, "Delete MCP server \"{{name}}\"? This action cannot be undone.");
});
