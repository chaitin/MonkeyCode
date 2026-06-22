import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  sidebar: readSource("../src/components/manager/manager-sidebar.tsx"),
  navTeams: readSource("../src/components/manager/nav-teams.tsx"),
  navManager: readSource("../src/components/manager/nav-manager.tsx"),
  page: readSource("../src/pages/console/manager/page.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("管理后台外壳使用 managerShell i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.sidebar, /t\("managerShell\.brand\.subtitle"\)/);
  assert.match(sourceFiles.navTeams, /t\("managerShell\.nav\.overview"\)/);
  assert.match(sourceFiles.navTeams, /t\("managerShell\.nav\.members"\)/);
  assert.match(sourceFiles.navManager, /t\("managerShell\.account\.changePassword\.title"\)/);
  assert.match(sourceFiles.navManager, /t\("managerShell\.account\.logout\.confirmTitle"\)/);
  assert.match(sourceFiles.page, /t\("managerShell\.actions\.refresh"\)/);
  assert.match(sourceFiles.page, /t\("managerShell\.breadcrumb\.fallback"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("管理后台外壳提供中英文资源", () => {
  assert.equal(cn.managerShell.nav.overview, "仪表盘");
  assert.equal(en.managerShell.nav.overview, "Dashboard");
  assert.equal(cn.managerShell.account.changePassword.title, "修改密码");
  assert.equal(en.managerShell.account.changePassword.title, "Change password");
  assert.equal(cn.managerShell.actions.refresh, "刷新");
  assert.equal(en.managerShell.actions.refresh, "Refresh");
});
