import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  userPage: readSource("../src/pages/console/user/page.tsx"),
  userSidebar: readSource("../src/components/console/nav/user-sidebar.tsx"),
  navUser: readSource("../src/components/console/nav/nav-user.tsx"),
  navCommunity: readSource("../src/components/console/nav/nav-community.tsx"),
  communityDialog: readSource("../src/components/console/nav/community-dialog.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("用户控制台外壳和基础导航使用 consoleShell i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleShell\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.userPage, /t\("consoleShell\.breadcrumbs\.dashboard"\)/);
  assert.match(sourceFiles.userSidebar, /IS_OFFLINE_EDITION/);
  assert.match(sourceFiles.userSidebar, /CONSULT_PURCHASE_URL = "https:\/\/baizhi\.cloud\/consult"/);
  assert.match(sourceFiles.userSidebar, /MONKEYCODE_REPOSITORY_URL = "https:\/\/github\.com\/chaitin\/monkeycode"/);
  assert.match(sourceFiles.userSidebar, /t\("consoleShell\.sidebar\.consultPurchase"\)/);
  assert.match(sourceFiles.userSidebar, /t\("consoleShell\.sidebar\.currentVersion"\)/);
  assert.match(sourceFiles.userSidebar, /t\("consoleShell\.sidebar\.update"\)/);
  assert.match(sourceFiles.userSidebar, /target="_blank"/);
  assert.match(sourceFiles.userSidebar, /t\("consoleShell\.sidebar\.settings"\)/);
  assert.match(sourceFiles.navUser, /t\("consoleShell\.user\.unknown"\)/);
  assert.match(sourceFiles.navCommunity, /t\("consoleShell\.community\.title"\)/);
  assert.match(sourceFiles.communityDialog, /t\("consoleShell\.community\.dialogTitle"\)/);
});

test("用户控制台外壳提供中英文资源", () => {
  assert.equal(cn.consoleShell.breadcrumbs.dashboard, "仪表盘");
  assert.equal(en.consoleShell.breadcrumbs.dashboard, "Dashboard");
  assert.equal(cn.consoleShell.sidebar.consultPurchase, "咨询采购");
  assert.equal(en.consoleShell.sidebar.consultPurchase, "Contact sales");
  assert.equal(cn.consoleShell.sidebar.currentVersion, "当前版本");
  assert.equal(en.consoleShell.sidebar.currentVersion, "Current version");
  assert.equal(cn.consoleShell.sidebar.update, "更新");
  assert.equal(en.consoleShell.sidebar.update, "Update");
  assert.equal(cn.consoleShell.sidebar.settings, "配置");
  assert.equal(en.consoleShell.sidebar.settings, "Settings");
  assert.equal(cn.consoleShell.community.dialogTitle, "扫码加入技术交流群");
  assert.equal(en.consoleShell.community.dialogTitle, "Scan to join the developer community");
});
