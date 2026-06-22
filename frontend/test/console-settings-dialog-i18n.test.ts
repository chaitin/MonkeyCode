import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL("../src/components/console/settings/settings-dialog.tsx", import.meta.url),
  "utf8",
);
const cjkPattern = /[\u3400-\u9fff]/;

test("设置弹窗外壳使用 consoleSettings dialog i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /consoleSettings\.dialog\./);
  assert.match(source, /consoleSettings\.nav\./);
  assert.doesNotMatch(source, cjkPattern);
});

test("设置弹窗外壳提供中英文资源", () => {
  assert.equal(cn.consoleSettings.dialog.title, "配置");
  assert.equal(en.consoleSettings.dialog.title, "Settings");
  assert.equal(cn.consoleSettings.nav.identities, "Git 身份");
  assert.equal(en.consoleSettings.nav.identities, "Git identities");
  assert.equal(cn.consoleSettings.githubApp.successTitle, "GitHub App 安装成功");
  assert.equal(en.consoleSettings.githubApp.successTitle, "GitHub App installed");
});
