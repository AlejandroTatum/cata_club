import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    allowOnly: false,
    fileParallelism: false,
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      // Pisos apenas debajo de la cobertura real medida el 2026-07-30
      // (81.26% statements, 84.91% branches, 82.07% functions): una caída
      // notable rompe el build, el ruido de un punto no. Con esto el paso
      // "Coverage report" de CI es un gate real (ya sin continue-on-error).
      thresholds: {
        statements: 80,
        branches: 83,
        functions: 80,
        lines: 80,
      },
    },
  },
});
