import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSelfHostingResources,
  MIN_INCLUDED_PARALLEL_TASKS,
  TASK_CONCURRENCY_OPTIONS,
  TASK_RESOURCE_INCREMENT,
} from "../src/utils/self-hosting-resources.ts";

test("私有化最低资源配置覆盖 8 个并发任务", () => {
  const resources = calculateSelfHostingResources(8);

  assert.equal(MIN_INCLUDED_PARALLEL_TASKS, 8);
  assert.deepEqual(TASK_RESOURCE_INCREMENT, {
    cpuCores: 0.2,
    memoryGb: 1,
    diskGb: 8,
  });
  assert.deepEqual(resources.console, {
    cpuCores: 2,
    memoryGb: 4,
    diskGb: 40,
  });
  assert.deepEqual(resources.host, {
    cpuCores: 4,
    memoryGb: 16,
    diskGb: 100,
  });
});

test("超过 8 个并发任务后按任务增量向上取整", () => {
  assert.deepEqual(calculateSelfHostingResources(16).host, {
    cpuCores: 6,
    memoryGb: 24,
    diskGb: 200,
  });
  assert.deepEqual(calculateSelfHostingResources(24).host, {
    cpuCores: 8,
    memoryGb: 32,
    diskGb: 300,
  });
});

test("资源计算器提供更多并发任务选项", () => {
  assert.deepEqual(TASK_CONCURRENCY_OPTIONS, [10, 20, 30, 40, 60, 80, 120, 160, 240, 320, 480, 640, 960, 1280]);
});

test("并发任务数会归一化为至少 1 个整数", () => {
  assert.equal(calculateSelfHostingResources(0).parallelTasks, 1);
  assert.equal(calculateSelfHostingResources(9.2).parallelTasks, 10);
});
