import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  privacyPolicy: readSource("../src/pages/privacy-policy.tsx"),
  userAgreement: readSource("../src/pages/user-agreement.tsx"),
  legalPageI18n: readSource("../src/pages/legal-page-i18n.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("法律页面使用 legalPages i18n key", () => {
  assert.match(sourceFiles.privacyPolicy, /useTranslation/);
  assert.match(sourceFiles.privacyPolicy, /t\("legalPages\.privacy"/);
  assert.match(sourceFiles.privacyPolicy, /legalPages\.privacy\.contact/);
  assert.doesNotMatch(sourceFiles.privacyPolicy, cjkPattern);

  assert.match(sourceFiles.userAgreement, /useTranslation/);
  assert.match(sourceFiles.userAgreement, /t\("legalPages\.userAgreement"/);
  assert.match(sourceFiles.userAgreement, /legalPages\.userAgreement\.contact/);
  assert.doesNotMatch(sourceFiles.userAgreement, cjkPattern);

  assert.match(sourceFiles.legalPageI18n, /renderOfficialChannels/);
  assert.doesNotMatch(sourceFiles.legalPageI18n, cjkPattern);
});

test("法律页面提供中英文资源", () => {
  assert.equal(cn.legalPages.privacy.title, "隐私政策");
  assert.equal(en.legalPages.privacy.title, "Privacy Policy");
  assert.equal(cn.legalPages.privacy.sections[0].title, "我们可能收集的信息");
  assert.equal(en.legalPages.privacy.sections[0].title, "Information We May Collect");

  assert.equal(cn.legalPages.userAgreement.title, "用户协议");
  assert.equal(en.legalPages.userAgreement.title, "User Agreement");
  assert.equal(cn.legalPages.userAgreement.sections[0].title, "协议适用范围");
  assert.equal(en.legalPages.userAgreement.sections[0].title, "Scope of Agreement");
});
