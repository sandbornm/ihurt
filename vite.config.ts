import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: "node_modules/.vite-app",
  plugins: [react()],
  optimizeDeps: {
    include: ["three", "lucide-react"],
    exclude: ["@mediapipe/tasks-vision"],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    outDir: "dist/app",
    rollupOptions: {
      output: { manualChunks: { three: ["three"], icons: ["lucide-react"] } },
    },
  },
});
