import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const navTeamsSource = readFileSync(
  new URL("../src/components/manager/nav-teams.tsx", import.meta.url),
  "utf8",
);

test("管理后台 sidebar 不渲染企业管理分组标题", () => {
  assert.equal(
    navTeamsSource.includes("<SidebarGroupLabel>企业管理</SidebarGroupLabel>"),
    false,
    `${repoRoot}/src/components/manager/nav-teams.tsx should not render 企业管理 group label`,
  );
});
