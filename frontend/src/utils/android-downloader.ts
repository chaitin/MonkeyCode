type AndroidDownloaderPlugin = {
  downloadFile(options: { url: string; filename: string }): Promise<{ downloadId?: number; filename?: string }>
}

type WindowWithCapacitor = Window & {
  Capacitor?: {
    getPlatform?: () => string
    Plugins?: {
      AndroidDownloader?: AndroidDownloaderPlugin
    }
    isNativePlatform?: () => boolean
  }
}

export function isAndroidNativePlatform(): boolean {
  const capacitor = (window as WindowWithCapacitor).Capacitor
  if (!capacitor) {
    return false
  }

  const platform = capacitor.getPlatform?.()
  return Boolean(capacitor.isNativePlatform?.() && platform === 'android')
}

export async function downloadFileWithAndroidPlugin(url: string, filename: string): Promise<boolean> {
  const capacitor = (window as WindowWithCapacitor).Capacitor
  const plugin = capacitor?.Plugins?.AndroidDownloader

  if (!plugin || !isAndroidNativePlatform()) {
    return false
  }

  await plugin.downloadFile({ url, filename })
  return true
}
