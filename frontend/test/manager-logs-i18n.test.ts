import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const files = [
  "../src/pages/console/manager/logs.tsx",
  "../src/components/manager/team-data-table-pagination.tsx",
] as const;
const sources = files.map((file) =>
  readFileSync(new URL(file, import.meta.url), "utf8"),
);
const combinedSource = sources.join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

test("manager logs and pagination use i18n keys", () => {
  assert.match(combinedSource, /useTranslation/);
  assert.match(combinedSource, /t\("managerLogs\.columns\.time"\)/);
  assert.match(combinedSource, /t\("managerLogs\.actions\.viewRequest"\)/);
  assert.match(combinedSource, /t\("managerPagination\.perPage"\)/);
  for (const source of sources) {
    assert.doesNotMatch(source, cjkPattern);
  }
});

test("manager logs and pagination provide Chinese and English resources", () => {
  assert.equal(cn.managerLogs.columns.time, "时间");
  assert.equal(en.managerLogs.columns.time, "Time");
  assert.equal(cn.managerPagination.perPage, "每页显示：");
  assert.equal(en.managerPagination.perPage, "Rows per page:");
});
