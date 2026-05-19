import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts"],
      // Barrel files and the still-stub interface packages carry no logic.
      exclude: [
        "**/*.test.ts",
        "**/index.ts",
        "packages/cli/**",
        "packages/mcp-server/**",
        "packages/service/**",
      ],
    },
  },
});
