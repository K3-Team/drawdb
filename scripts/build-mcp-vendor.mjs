// Bundles the client's SQL exporters (src/utils/exportSQL) into a single
// Node-safe ESM module the MCP service reuses (mcp/vendor/exportSQL.js). Those
// modules use Vite-style extensionless imports that plain Node can't resolve;
// the bundler resolves them and inlines the whole pure, dependency-free chain
// — including the sqlSafety hardening — so the MCP service gets identical,
// tested SQL generation without duplicating six dialects.
//
// Uses vite's programmatic build() with configFile:false (a plain
// `vite build --config` trips rolldown-vite's config bundler). Run via
// `npm run build:mcp-vendor`.
import { build } from "vite";
import { fileURLToPath } from "node:url";

const url = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  configFile: false,
  logLevel: "warn",
  // Don't copy public/ (favicon, images) into the vendor dir.
  publicDir: false,
  build: {
    lib: {
      entry: url("../src/utils/exportSQL/index.js"),
      formats: ["es"],
      fileName: () => "exportSQL.js",
    },
    outDir: url("../mcp/vendor"),
    emptyOutDir: false,
    minify: false,
    target: "node20",
    rollupOptions: { output: { entryFileNames: "exportSQL.js" } },
  },
});
