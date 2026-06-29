import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  addIdentity: readSource("../src/components/console/settings/add-identity.tsx"),
  editIdentity: readSource("../src/components/console/settings/edit-identity.tsx"),
  identities: readSource("../src/components/console/settings/identities.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("设置身份页面使用 consoleSettings identities i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleSettings\.identities\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.addIdentity, /t\("consoleSettings\.identities\.add\.title"\)/);
  assert.match(sourceFiles.editIdentity, /t\("consoleSettings\.identities\.edit\.title"\)/);
  assert.match(sourceFiles.identities, /t\("consoleSettings\.identities\.title"\)/);
  assert.match(sourceFiles.identities, /identity\.is_installation_app === true/);
  assert.match(sourceFiles.identities, /t\("consoleSettings\.identities\.actions\.rebind"\)/);
});

test("设置身份页面提供中英文资源", () => {
  assert.equal(cn.consoleSettings.identities.title, "Git 平台身份凭证");
  assert.equal(en.consoleSettings.identities.title, "Git platform identities");
  assert.equal(cn.consoleSettings.identities.actions.bindOther, "绑定其他平台");
  assert.equal(en.consoleSettings.identities.actions.bindOther, "Bind another platform");
  assert.equal(cn.consoleSettings.identities.actions.rebind, "重新绑定");
  assert.equal(en.consoleSettings.identities.actions.rebind, "Rebind");
  assert.equal(cn.consoleSettings.identities.delete.description, "确定要移除身份 \"{{name}}\" 吗？此操作不可撤销。");
  assert.equal(en.consoleSettings.identities.delete.description, "Remove identity \"{{name}}\"? This action cannot be undone.");
});
