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
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/e2e/helpers/**/*.unit.test.ts",
    ],
    allowOnly: false,
    // Files run in parallel on the default `forks` pool. Workers are capped
    // so CI (4 vCPU) and local runs behave predictably (#1505).
    maxWorkers: 4,
    // Heavy interaction tests (paginating 205 rows, multi-step confirm flows)
    // sit near the 5 s default once workers contend for CPU under coverage.
    testTimeout: 15_000,
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
