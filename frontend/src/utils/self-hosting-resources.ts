export type MachineResources = {
  cpuCores: number;
  memoryGb: number;
  diskGb: number;
};

export type SelfHostingResourcePlan = {
  parallelTasks: number;
  includedParallelTasks: number;
  extraParallelTasks: number;
  console: MachineResources;
  host: MachineResources;
};

export const MIN_INCLUDED_PARALLEL_TASKS = 8;
export const TASK_CONCURRENCY_OPTIONS = [10, 20, 30, 40, 60, 80, 120, 160, 240, 320, 480, 640, 960, 1280] as const;

export const CONSOLE_MIN_RESOURCES: MachineResources = {
  cpuCores: 2,
  memoryGb: 4,
  diskGb: 40,
};

export const HOST_MIN_RESOURCES: MachineResources = {
  cpuCores: 4,
  memoryGb: 16,
  diskGb: 100,
};

export const TASK_RESOURCE_INCREMENT: MachineResources = {
  cpuCores: 0.2,
  memoryGb: 1,
  diskGb: 8,
};

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function normalizeParallelTasks(value: number) {
  return Math.max(1, Math.ceil(Number.isFinite(value) ? value : MIN_INCLUDED_PARALLEL_TASKS));
}

export function calculateSelfHostingResources(parallelTasks: number): SelfHostingResourcePlan {
  const normalizedParallelTasks = normalizeParallelTasks(parallelTasks);
  const extraParallelTasks = Math.max(0, normalizedParallelTasks - MIN_INCLUDED_PARALLEL_TASKS);

  return {
    parallelTasks: normalizedParallelTasks,
    includedParallelTasks: MIN_INCLUDED_PARALLEL_TASKS,
    extraParallelTasks,
    console: { ...CONSOLE_MIN_RESOURCES },
    host: {
      cpuCores: roundUp(HOST_MIN_RESOURCES.cpuCores + extraParallelTasks * TASK_RESOURCE_INCREMENT.cpuCores, 2),
      memoryGb: roundUp(HOST_MIN_RESOURCES.memoryGb + extraParallelTasks * TASK_RESOURCE_INCREMENT.memoryGb, 4),
      diskGb: roundUp(HOST_MIN_RESOURCES.diskGb + extraParallelTasks * TASK_RESOURCE_INCREMENT.diskGb, 100),
    },
  };
}
