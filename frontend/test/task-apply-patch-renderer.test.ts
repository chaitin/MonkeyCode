import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageToolcallSource = readFileSync(
  new URL("../src/components/console/task/message-toolcall.tsx", import.meta.url),
  "utf8",
);
const applyPatchSource = readFileSync(
  new URL("../src/components/console/task/toolcalls/apply_patch.tsx", import.meta.url),
  "utf8",
);

test("apply_patch tool calls are matched by title before opencode edit rendering", () => {
  assert.match(messageToolcallSource, /import \* as applyPatchRender/);
  assert.match(messageToolcallSource, /match: applyPatchRender\.match/);
  assert.doesNotMatch(messageToolcallSource, /message\.data\.kind === "other"[\s\S]{0,120}message\.data\.title === "apply_patch"/);

  const applyPatchIndex = messageToolcallSource.indexOf("match: applyPatchRender.match");
  const opencodeEditIndex = messageToolcallSource.indexOf("cli === ConstsCliName.CliNameOpencode && message.data.kind === \"edit\"");
  assert.ok(applyPatchIndex >= 0);
  assert.ok(opencodeEditIndex >= 0);
  assert.ok(applyPatchIndex < opencodeEditIndex);
});

test("apply_patch detail renders patchText without forcing old/new diff preview", () => {
  assert.match(applyPatchSource, /export const match = \(message: MessageType\) => message\.data\.title === "apply_patch"/);
  assert.match(applyPatchSource, /message\.data\.rawInput\?\.patchText/);
  assert.match(applyPatchSource, /isUnifiedDiffText/);
  assert.match(applyPatchSource, /isApplyPatchText/);
  assert.match(applyPatchSource, /parseApplyPatchSections/);
  assert.match(applyPatchSource, /renderPatchContent/);
  assert.match(messageToolcallSource, /applyPatchRender\.renderPatchContent\(diff \|\| patchText\)/);
});

test("apply_patch success output is matched even when opencode reports kind edit", () => {
  assert.match(messageToolcallSource, /message\.data\.title\?\.startsWith\("Success\. Updated the following files:"\)/);
  assert.doesNotMatch(messageToolcallSource, /message\.data\.kind === "other"\s*&&\s*!!message\.data\.title\?\.startsWith\("Success\. Updated the following files:"\)/);

  const successIndex = messageToolcallSource.indexOf("Success. Updated the following files:");
  const opencodeEditIndex = messageToolcallSource.indexOf("cli === ConstsCliName.CliNameOpencode && message.data.kind === \"edit\"");
  assert.ok(successIndex >= 0);
  assert.ok(opencodeEditIndex >= 0);
  assert.ok(successIndex < opencodeEditIndex);
});
