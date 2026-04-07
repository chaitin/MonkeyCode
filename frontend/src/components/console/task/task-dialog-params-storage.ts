const TASK_PARAM_STORAGE_KEY = "task_input_dialog_params";

export interface StoredTaskDialogParams {
  modelId?: string;
  hostId?: string;
  imageId?: string;
}

export function readStoredTaskDialogParams(): StoredTaskDialogParams {
  try {
    const raw = window.localStorage.getItem(TASK_PARAM_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as StoredTaskDialogParams;
    return {
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : undefined,
      hostId: typeof parsed.hostId === "string" ? parsed.hostId : undefined,
      imageId: typeof parsed.imageId === "string" ? parsed.imageId : undefined,
    };
  } catch {
    return {};
  }
}

export function writeStoredTaskDialogParams(params: StoredTaskDialogParams) {
  try {
    window.localStorage.setItem(TASK_PARAM_STORAGE_KEY, JSON.stringify(params));
  } catch {
    // ignore storage write failures
  }
}
