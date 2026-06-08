import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appEdition = process.env.VITE_APP_EDITION ?? env.VITE_APP_EDITION
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
          target: env.TARGET,
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
