// TEST-ONLY build config -- not used for the deployed app (see vite.config.js
// for that). jsdom, which the smoke-test harness for this project uses,
// cannot execute inline `type="module"` scripts at all. The real deployed
// build no longer needs to work around that (nginx serves a normal
// multi-asset build fine, and real browsers execute `type="module"` over
// http(s) without issue), but this config keeps producing a single inlined,
// IIFE-format, jsdom-testable HTML artifact from the same `src/`, purely so
// automated interaction tests can keep running against real component code.
// Run with: npx vite build --config vite.config.test.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The built script tag lives in <head> (Vite's standard placement) and
// relies on type="module"'s automatic defer-until-parsed timing. The bundle
// is forced to plain IIFE output (below) for compatibility with tools/
// consumers that don't handle inline module scripts -- but `defer`/`async`
// are no-ops on inline scripts per the HTML spec (they only affect scripts
// with a `src`), so merely swapping the type attribute still runs the script
// immediately in <head>, before <div id="root"> exists in <body>, and
// React's createRoot throws immediately. The only spec-correct fix for an
// inline classic script is to physically move it to the end of <body>, after
// the element it targets. Runs in writeBundle (after vite-plugin-singlefile's
// generateBundle has already inlined the script into index.html on disk).
function moveInlineScriptToEndOfBody() {
  return {
    name: "move-inline-script-to-end-of-body",
    apply: "build",
    writeBundle(options) {
      const outFile = join(options.dir, "index.html");
      const html = readFileSync(outFile, "utf-8");

      const openTagMatch = html.match(/<script type="module" crossorigin>/);
      const bodyClose = html.lastIndexOf("</body>");
      if (!openTagMatch || bodyClose === -1) {
        this.warn("move-inline-script-to-end-of-body: expected script tag or </body> not found");
        return;
      }
      const scriptStart = openTagMatch.index;
      // The bundle's own source may contain escaped "<\/script>" string
      // literals (e.g. React's internal script-tag handling code) -- those
      // have a backslash before the slash, so they never match the literal,
      // unescaped "</script>" that actually closes this element. The real
      // closing tag is therefore the LAST literal occurrence in the file.
      const closeTagStr = "</script>";
      const scriptEnd = html.lastIndexOf(closeTagStr) + closeTagStr.length;

      const scriptBlock = html
        .slice(scriptStart, scriptEnd)
        .replace('<script type="module" crossorigin>', "<script>");

      const withoutScript = html.slice(0, scriptStart) + html.slice(scriptEnd);
      const newBodyClose = withoutScript.lastIndexOf("</body>");
      const patched =
        withoutScript.slice(0, newBodyClose) + scriptBlock + "\n" + withoutScript.slice(newBodyClose);

      writeFileSync(outFile, patched, "utf-8");
    },
  };
}

export default defineConfig({
  plugins: [react(), viteSingleFile(), moveInlineScriptToEndOfBody()],
  build: {
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    outDir: "dist-test",
    rollupOptions: {
      output: {
        format: "iife",
      },
    },
  },
});
