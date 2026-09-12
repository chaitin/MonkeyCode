import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const backend = process.env.MONKEYAI_DEV_BACKEND_URL ?? "http://localhost:8080"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": backend,
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
