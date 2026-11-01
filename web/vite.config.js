import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on MCP_FLOW_PORT (default 6650) and Vite on VITE_PORT (default 6660); /api is proxied.
const api = { target: `http://127.0.0.1:${Number(process.env.MCP_FLOW_PORT) || 6650}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 6660, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", include: ["src/test/*.test.{js,jsx}"] },
});
