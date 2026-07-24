import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  checkin: readSource("../src/components/console/nav/nav-checkin.tsx"),
  invite: readSource("../src/components/console/nav/nav-invite.tsx"),
  essay: readSource("../src/components/console/nav/nav-essay.tsx"),
  freeModelUsage: readSource("../src/components/console/nav/free-model-usage-indicator.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("侧边栏在线权益入口使用 consoleShell rewards i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /consoleShell\.rewards\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.checkin, /t\("consoleShell\.rewards\.checkin\.label"\)/);
  assert.match(sourceFiles.invite, /t\("consoleShell\.rewards\.invite\.title"\)/);
  assert.match(sourceFiles.essay, /t\("consoleShell\.rewards\.essay\.label"\)/);
  assert.match(sourceFiles.freeModelUsage, /export function RewardsBalanceIndicator/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.quota\.freeWithValue", \{ amount: formatTokenNumber\(remainingTokens\) \}\)/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.feedback\.button"\)/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.feedback\.description"\)/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.feedback\.templateLabel"\)/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.feedback\.templateCopy"\)/);
  assert.match(sourceFiles.freeModelUsage, /t\("consoleShell\.rewards\.feedback\.copySuccess"\)/);
  assert.match(sourceFiles.freeModelUsage, /const feedbackTemplate = t\("consoleShell\.rewards\.feedback\.template", \{ uid: userId \}\)/);
  assert.match(sourceFiles.freeModelUsage, /navigator\.clipboard\.writeText\(feedbackTemplate\)/);
  assert.match(sourceFiles.freeModelUsage, /const \{\s*user,\s*\} = useCommonData\(\)/);
  assert.match(sourceFiles.freeModelUsage, /const userId = user\?\.id \|\| "-"/);
  assert.match(sourceFiles.freeModelUsage, /className="hidden h-8[\s\S]*lg:inline-flex/);
  assert.match(sourceFiles.freeModelUsage, /const GITHUB_REPOSITORY_URL = "https:\/\/github\.com\/chaitin\/monkeycode"/);
  assert.match(sourceFiles.freeModelUsage, /window\.open\(GITHUB_REPOSITORY_URL, "_blank", "noopener,noreferrer"\)/);
});

test("侧边栏在线权益入口提供中英文资源", () => {
  assert.equal(cn.consoleShell.rewards.checkin.label, "签到领积分");
  assert.equal(en.consoleShell.rewards.checkin.label, "Check in for credits");
  assert.equal(cn.consoleShell.rewards.invite.title, "邀请注册赚积分");
  assert.equal(en.consoleShell.rewards.invite.title, "Invite users for credits");
  assert.equal(cn.consoleShell.rewards.quota.freeQuota, "会员额度");
  assert.equal(en.consoleShell.rewards.quota.freeQuota, "Membership quota");
  assert.equal(cn.consoleShell.rewards.quota.freeWithValue, "今日额度 {{amount}}");
  assert.equal(en.consoleShell.rewards.quota.freeWithValue, "Daily quota {{amount}}");
  assert.equal(cn.consoleShell.rewards.quota.creditsSummary, "积分 {{value}}");
  assert.equal(en.consoleShell.rewards.quota.creditsSummary, "Credits {{value}}");
  assert.equal(cn.consoleShell.rewards.quota.membershipCredits, "会员与积分");
  assert.equal(en.consoleShell.rewards.quota.membershipCredits, "Membership and credits");
  assert.equal(cn.consoleShell.rewards.feedback.button, "提个建议");
  assert.equal(en.consoleShell.rewards.feedback.button, "Feedback");
  assert.equal(cn.consoleShell.rewards.feedback.templateLabel, "反馈模板");
  assert.equal(en.consoleShell.rewards.feedback.templateLabel, "Feedback template");
  assert.equal(cn.consoleShell.rewards.feedback.action, "去 GitHub 反馈");
  assert.equal(en.consoleShell.rewards.feedback.action, "Give feedback on GitHub");
  assert.match(cn.consoleShell.rewards.feedback.template, /\{\{uid\}\}/);
  assert.match(cn.consoleShell.rewards.feedback.template, /我的 UID/);
  assert.match(en.consoleShell.rewards.feedback.template, /\{\{uid\}\}/);
  assert.equal(cn.consoleShell.rewards.feedback.description, "到 MonkeyCode 的 GitHub 提 Issue，并留下你的 UID。\nIssue 被采纳后你将获得 3 万积分的奖励。");
});

test("权益浮层可容纳英文长文案", () => {
  assert.match(sourceFiles.freeModelUsage, /className="w-96 max-w-\[calc\(100vw-2rem\)\]"/);
  assert.match(sourceFiles.freeModelUsage, /className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"/);
  assert.match(sourceFiles.freeModelUsage, /className="shrink-0 font-medium"/);
  assert.match(sourceFiles.freeModelUsage, /className="ml-auto shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground"/);
});
