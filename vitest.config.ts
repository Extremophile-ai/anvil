import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});
