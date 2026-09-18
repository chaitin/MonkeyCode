import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const backend = process.env.MONKEYAI_DEV_BACKEND_URL ?? "http://localhost:8080"
const apiBackend = process.env.MONKEYAI_DEV_API_URL ?? "https://demo.monkeycode-ai.com"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "^/api/v1/endpoints/connect$": { target: apiBackend, changeOrigin: true, ws: true },
      "/api": { target: apiBackend, changeOrigin: true },
      "/oauth": backend,
      "/mcp": backend,
      "/v1": backend,
      "/.well-known/oauth-authorization-server": backend,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
