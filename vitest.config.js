import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
    exclude: ["**/node_modules/**", "src/utils/importSQL/normalize.test.js"],
  },
});
