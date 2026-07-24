import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy target for the collab server. Mirror its PORT env var (see
// server/index.js) so changing the backend port also moves the proxy — both
// processes are launched together by `npm run dev` and share the shell env.
const backendPort = process.env.PORT || "3000";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${backendPort}`,
      "/ws": {
        target: `ws://127.0.0.1:${backendPort}`,
        ws: true,
      },
    },
  },
});
