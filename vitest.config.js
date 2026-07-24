import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
    exclude: ["**/node_modules/**", "src/utils/importSQL/normalize.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/**/*.test.{js,jsx}",
        "src/main.jsx",
        "src/monaco.js",
        "src/i18n/**",
        "src/assets/**",
      ],
      // Ratchet, not aspiration: floors for the areas we now test (the large
      // presentational UI stays uncovered by design). Regressing these fails CI.
      thresholds: {
        "src/utils/exportAs/**": { lines: 70, functions: 70 },
        "src/utils/importSQL/**": { lines: 25, functions: 15 },
        "src/utils/importFrom/**": { lines: 85, functions: 85 },
        "src/utils/migrations/**": { lines: 20, functions: 25 },
        "src/context/CollabContext.jsx": { lines: 45, functions: 40 },
      },
    },
  },
});
