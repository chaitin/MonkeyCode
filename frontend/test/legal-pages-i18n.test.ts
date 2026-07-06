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
  assert.match(sourceFiles.privacyPolicy, /useAppRuntime/);
  assert.match(sourceFiles.privacyPolicy, /const \{ serverConfig \} = useAppRuntime\(\)/);
  assert.match(sourceFiles.privacyPolicy, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(sourceFiles.privacyPolicy, /t\("legalPages\.privacy"/);
  assert.match(sourceFiles.privacyPolicy, /legalPages\.privacy\.contact/);
  assert.match(sourceFiles.privacyPolicy, /renderOfficialChannels\(t, "legalPages\.privacy\.contact", isGlobalRegion\)/);
  assert.doesNotMatch(sourceFiles.privacyPolicy, cjkPattern);

  assert.match(sourceFiles.userAgreement, /useTranslation/);
  assert.match(sourceFiles.userAgreement, /useAppRuntime/);
  assert.match(sourceFiles.userAgreement, /const \{ serverConfig \} = useAppRuntime\(\)/);
  assert.match(sourceFiles.userAgreement, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(sourceFiles.userAgreement, /t\("legalPages\.userAgreement"/);
  assert.match(sourceFiles.userAgreement, /legalPages\.userAgreement\.contact/);
  assert.match(sourceFiles.userAgreement, /renderOfficialChannels\(t, "legalPages\.userAgreement\.contact", isGlobalRegion\)/);
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

test("法律页面官方渠道按国内和国际版切换品牌和链接", () => {
  assert.match(sourceFiles.legalPageI18n, /isGlobalRegion \?/);
  assert.match(sourceFiles.legalPageI18n, /primaryHref: "https:\/\/www\.chaitin\.cn\/"/);
  assert.match(sourceFiles.legalPageI18n, /secondaryHref: "https:\/\/www\.baizhi\.cloud\/"/);
  assert.match(sourceFiles.legalPageI18n, /primaryHref: "https:\/\/www\.cyberserval\.com\/"/);
  assert.match(sourceFiles.legalPageI18n, /secondaryHref: "https:\/\/cyberserval\.tech"/);
  assert.match(sourceFiles.legalPageI18n, /\$\{keyPrefix\}\.\$\{channels\.primaryKey\}/);
  assert.match(sourceFiles.legalPageI18n, /\$\{keyPrefix\}\.\$\{channels\.secondaryKey\}/);

  const legalPageCopy = JSON.stringify({
    cn: cn.legalPages,
    en: en.legalPages,
  });
  assert.match(legalPageCopy, /长亭科技官网/);
  assert.match(legalPageCopy, /长亭百智云官网/);
  assert.match(legalPageCopy, /Cyberserval|CyberServal/);
  assert.match(legalPageCopy, /SafeLine WAF/);
  assert.equal(cn.legalPages.privacy.contact.chaitin, "长亭科技官网");
  assert.equal(cn.legalPages.privacy.contact.baizhi, "长亭百智云官网");
  assert.equal(cn.legalPages.privacy.contact.cyberserval, "CyberServal 官网");
  assert.equal(cn.legalPages.privacy.contact.safelineWaf, "SafeLine WAF");
  assert.equal(cn.legalPages.userAgreement.contact.chaitin, "长亭科技官网");
  assert.equal(cn.legalPages.userAgreement.contact.baizhi, "长亭百智云官网");
  assert.equal(cn.legalPages.userAgreement.contact.cyberserval, "CyberServal 官网");
  assert.equal(cn.legalPages.userAgreement.contact.safelineWaf, "SafeLine WAF");
  assert.equal(en.legalPages.privacy.contact.chaitin, "Chaitin Tech website");
  assert.equal(en.legalPages.privacy.contact.baizhi, "Chaitin Baizhi Cloud website");
  assert.equal(en.legalPages.privacy.contact.cyberserval, "CyberServal website");
  assert.equal(en.legalPages.privacy.contact.safelineWaf, "SafeLine WAF");
  assert.equal(en.legalPages.userAgreement.contact.chaitin, "Chaitin Tech website");
  assert.equal(en.legalPages.userAgreement.contact.baizhi, "Chaitin Baizhi Cloud website");
  assert.equal(en.legalPages.userAgreement.contact.cyberserval, "CyberServal website");
  assert.equal(en.legalPages.userAgreement.contact.safelineWaf, "SafeLine WAF");
});
