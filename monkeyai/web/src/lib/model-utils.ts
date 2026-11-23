const MODEL_ICON_MATCHERS = [
  { keywords: ["claude", "anthropic"], iconName: "icon-claude" },
  { keywords: ["deepseek"], iconName: "icon-deepseek" },
  { keywords: ["qwen", "tongyi", "通义"], iconName: "icon-qwen" },
  { keywords: ["doubao", "豆包"], iconName: "icon-doubao" },
  { keywords: ["gemini"], iconName: "icon-gemini" },
  { keywords: ["moonshot", "kimi"], iconName: "icon-moonshot" },
  { keywords: ["minimax"], iconName: "icon-minimax" },
  { keywords: ["hunyuan", "混元"], iconName: "icon-hunyuan" },
  { keywords: ["zhipu", "chatglm", "glm", "智谱"], iconName: "icon-zhipu" },
  { keywords: ["mimo", "xiaomi", "小米"], iconName: "icon-mimo" },
  {
    keywords: ["openai", "chatgpt", "gpt-", "o1", "o3", "o4"],
    iconName: "icon-openai",
  },
] as const

export function getModelIconName(modelName: string) {
  const normalizedName = modelName.trim().toLowerCase()
  const matchedModel = MODEL_ICON_MATCHERS.find(({ keywords }) =>
    keywords.some((keyword) => normalizedName.includes(keyword))
  )

  return matchedModel?.iconName ?? "icon-model"
}
