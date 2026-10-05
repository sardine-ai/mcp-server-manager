import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [
        "coverage/**",
        "dist/**",
        "tests/**",
        "**/*.d.ts",
        "src/types/**",
        "src/**/types.ts",
        "src/**/index.ts",
      ],
      thresholds: {
        statements: 80,
        lines: 80,
      },
    },
    // Prevent orphan processes and improve cleanup
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 3, // Limit concurrent forks to prevent resource exhaustion
      },
    },
    // Ensure tests don't hang
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    // Force exit after tests complete
    forceExit: true,
  },
});
