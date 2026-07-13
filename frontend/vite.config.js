import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standard multi-asset build -- served by nginx in the frontend Docker
// container, which also reverse-proxies /api to the backend. No need for the
// single-file/IIFE tricks the old file://-distributed version required (see
// vite.config.test.js for why that variant still exists, test-only).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // lets `npm run dev` talk to a locally-running backend without CORS
      "/api": "http://localhost:8000",
    },
  },
});
