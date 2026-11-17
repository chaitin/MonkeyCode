import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const backend = process.env.MONKEYAI_DEV_BACKEND_URL ?? "http://localhost:8080"
const apiBackend =
  process.env.MONKEYAI_DEV_API_URL ?? "https://work.chaitin.net"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: { target: "chrome86", cssTarget: "chrome86" },
  server: {
    allowedHosts: [".trycloudflare.com"],
    watch: {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    },
    proxy: {
      "^/api/v1/endpoints/connect$": {
        target: apiBackend,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      "^/api/v1/endpoint-bridge": {
        target: apiBackend,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      "^/api/v1/endpoints/[^/]+/proxy/": {
        target: apiBackend,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      "/endpoints": { target: apiBackend, changeOrigin: true, secure: false },
      "/api": { target: apiBackend, changeOrigin: true, secure: false },
      "/oauth": backend,
      "/mcp": backend,
      "/v1": backend,
      "/.well-known/oauth-authorization-server": {
        target: apiBackend,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
