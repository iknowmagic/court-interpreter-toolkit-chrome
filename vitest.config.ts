import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/test/**",
        "src/**/*.d.ts",
        "src/pages/popup/index.tsx",
        "src/pages/options/index.tsx",
      ],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 75,

        "src/background/timerRuntime.ts": {
          statements: 95,
          lines: 95,
          functions: 100,
          branches: 90,
        },

        "src/background/sessionTransitions.ts": {
          statements: 90,
          lines: 90,
          functions: 100,
          branches: 75,
        },

        "src/shared/practice.ts": {
          statements: 95,
          lines: 95,
          functions: 90,
          branches: 80,
        },
      },
    },
  },
});
