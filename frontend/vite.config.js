import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The deploy host serves this app under a sub-path (e.g. /crm-review-hub/) and
// injects VITE_BASE_PATH at build time. Vite's `base` must match so asset URLs
// in index.html are prefixed correctly -- otherwise the browser requests
// /assets/... at the domain root (404 -> blank page). Unset (local dev) => "/".
// The value comes in without a trailing slash (e.g. "/crm-review-hub"), so
// normalize to a leading + trailing slash, which Vite expects.
function normalizeBase(v) {
  if (!v) return "/";
  return "/" + v.replace(/^\/+|\/+$/g, "") + "/";
}

// Standard multi-asset build -- served by nginx in the frontend Docker
// container, which also reverse-proxies /api to the backend. (vite.config.test.js
// is a separate test-only single-file build.)
export default defineConfig({
  base: normalizeBase(process.env.VITE_BASE_PATH),
  plugins: [react()],
  server: {
    proxy: {
      // lets `npm run dev` talk to a locally-running backend without CORS
      "/api": "http://localhost:8000",
    },
  },
});
