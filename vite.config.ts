import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // MapLibre GL e mapbox-gl-draw in chunk separato (le librerie più pesanti)
          if (id.includes("maplibre-gl") || id.includes("mapbox__mapbox-gl-draw")) {
            return "vendor-map";
          }
          // Recharts + d3 in chunk separato
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-")) {
            return "vendor-charts";
          }
          // React core
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "vendor-react";
          }
          // Radix UI components
          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }
          // Tanstack query
          if (id.includes("@tanstack")) {
            return "vendor-tanstack";
          }
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
