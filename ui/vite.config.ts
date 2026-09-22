import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: here,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7800",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
})
