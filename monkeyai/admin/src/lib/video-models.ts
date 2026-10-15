export const VIDEO_MODELS = [
  { provider: "xai", label: "Grok Imagine Video 1.5", model: "grok-imagine-video-1.5" },
  { provider: "minimax", label: "MiniMax H3", model: "MiniMax-H3" },
  { provider: "volcengine", label: "Seedance 2.0", model: "doubao-seedance-2-0-260128" },
  { provider: "volcengine", label: "Seedance 2.5", model: "doubao-seedance-2-5-260628" },
  { provider: "agnes", label: "Agnes Video 2.5", model: "agnes-video-2.5" },
] as const

export type VideoProvider = (typeof VIDEO_MODELS)[number]["provider"]
export type VideoMode = "text_to_video" | "image_to_video" | "last_frame_to_video" | "first_last_to_video" | "reference_image_to_video"
type VideoValue = string | number | boolean
export type VideoConfig = { modes: VideoMode[]; defaults: Record<string, Record<string, VideoValue>> }
export type VideoCapabilities = {
  modes: VideoMode[]
  params: Array<{ name: string; type: "string" | "integer" | "boolean"; choices?: VideoValue[]; min?: number; max?: number }>
  param_rules?: Array<{ when: { modes?: VideoMode[] }; name: string; choices: VideoValue[] }>
}

export function videoResolutions(cap?: VideoCapabilities | null) {
  return cap?.params.find((param) => param.name === "resolution")?.choices?.filter((value): value is string => typeof value === "string") ?? []
}

export function videoDefaults(cap: VideoCapabilities, modes: VideoMode[], saved?: VideoConfig) {
  return Object.fromEntries(modes.map((mode) => {
    const values: Record<string, VideoValue> = {}
    for (const param of cap.params) {
      const rule = cap.param_rules?.find((item) => item.name === param.name && item.when.modes?.includes(mode))
      const choices = rule?.choices ?? param.choices
      const savedValue = saved?.defaults?.[mode]?.[param.name]
      const valid = savedValue !== undefined && (choices ? choices.includes(savedValue) : param.type === "boolean"
        ? typeof savedValue === "boolean"
        : typeof savedValue === "number" && Number.isInteger(savedValue) && savedValue >= (param.min ?? 0) && savedValue <= (param.max ?? Infinity))
      values[param.name] = savedValue !== undefined && valid
        ? savedValue
        : choices?.[0] ?? (param.type === "boolean" ? true : param.min ?? "")
    }
    return [mode, values]
  }))
}
