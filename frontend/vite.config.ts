import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const electronBuild = process.env.ELECTRON === 'true'

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
      allowedHosts: ['.monkeycode-ai.online'],
      proxy: {
        '/api': {
          target: env.TARGET,
          changeOrigin: true,
          ws: true
        }
      }
    }
  }
})
