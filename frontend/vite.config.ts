import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

interface OnlineProxyTargetOptions {
  command: string
  appEdition: string | undefined
  target: string | undefined
}

export function resolveOnlineProxyTarget({
  command,
  appEdition,
  target,
}: OnlineProxyTargetOptions): string | undefined {
  const normalizedTarget = target?.trim()

  if (command !== 'serve' || appEdition !== 'online') {
    return normalizedTarget || undefined
  }

  if (!normalizedTarget) {
    throw new Error(
      'TARGET is required for online preview. Example: TARGET=https://monkeycode-ai.com pnpm run dev:online',
    )
  }

  let parsedTarget: URL
  try {
    parsedTarget = new URL(normalizedTarget)
  } catch {
    throw new Error('TARGET must be an absolute HTTP(S) URL')
  }

  if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
    throw new Error('TARGET must be an absolute HTTP(S) URL')
  }

  return normalizedTarget
}

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appEdition = process.env.VITE_APP_EDITION ?? env.VITE_APP_EDITION
  const proxyTarget = resolveOnlineProxyTarget({
    command,
    appEdition,
    target: env.TARGET,
  })
  const electronBuild = process.env.ELECTRON === 'true'
  const devPort = 11180
  const proxyBasicAuthUsername = env.PROXY_BASIC_AUTH_USERNAME?.trim()
  const proxyBasicAuthPassword = env.PROXY_BASIC_AUTH_PASSWORD?.trim()
  const proxyHeaders: Record<string, string> = {}

  if (appEdition !== 'online' && appEdition !== 'offline') {
    throw new Error(
      `Invalid VITE_APP_EDITION: ${appEdition ?? '(missing)'}. Expected "online" or "offline".`,
    )
  }

  if (proxyBasicAuthUsername && proxyBasicAuthPassword) {
    proxyHeaders.Authorization = `Basic ${Buffer.from(`${proxyBasicAuthUsername}:${proxyBasicAuthPassword}`).toString('base64')}`
  }

  return {
    base: electronBuild ? './' : '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "global": "globalThis",
    },
    optimizeDeps: {
      include: ["buffer"],
      esbuildOptions: {
        define: {
          global: "globalThis",
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: devPort,
      allowedHosts: ['.monkeycode-ai.online'],
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
          ...(Object.keys(proxyHeaders).length > 0
            ? {
                headers: proxyHeaders,
              }
            : {}),
        }
      }
    }
  }
})
