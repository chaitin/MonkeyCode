interface ExtensionImportResult {
  created_skills?: number
  updated_skills?: number
  created_images?: number
  updated_images?: number
}

export function formatExtensionImportResult(result: ExtensionImportResult) {
  return `新增 ${result.created_skills ?? 0} 个 Skills，更新 ${result.updated_skills ?? 0} 个 Skills，新增 ${result.created_images ?? 0} 个镜像，更新 ${result.updated_images ?? 0} 个镜像`
}
