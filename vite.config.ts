import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import compression from "vite-plugin-compression";
import { visualizer } from "rollup-plugin-visualizer";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  cacheDir: "node_modules/.vite-app",
  plugins: [
    react(),
    compression({
      algorithm: "brotliCompress",
      ext: ".br",
      threshold: 1024,
    }),
    compression({
      algorithm: "gzip",
      ext: ".gz",
      threshold: 1024,
    }),
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: "dist/stats.html",
            open: false,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("@mediapipe")) return "vision";
          if (id.includes("src/voice/")) return "voice";
          if (id.includes("src/export.ts") || id.includes("src/sharing/"))
            return "export";
          if (id.includes("src/reading.ts") || id.includes("src/Resources"))
            return "research";
        },
      },
    },
  },
});
