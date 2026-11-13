import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// One fingerprint of the source code, the same for the website build and the PS Mac app build.
// Written to version.json so PS can tell when the website runs newer code than it does.
function srcStamp(): string {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else { h.update(p); h.update(readFileSync(p)); }
    }
  };
  walk("src");
  h.update(readFileSync("index.html"));
  return h.digest("hex").slice(0, 16);
}
// Worked out once per build, so the page's own stamp (__WEB_SRC__) and version.json always agree.
let stampMemo = "";
const stamp = () => (stampMemo ||= srcStamp());
// The same for the build time (__WEB_BUILT__ and version.json "built"), so a page knows whether a note is older than itself.
let builtMemo = "";
const built = () => (builtMemo ||= new Date().toISOString());
// The page compatibility number (src/core/webupdate.ts WEB_COMPAT): an open page with a lower one asks
// to be reloaded and says why (it never reloads by itself).
function webCompat(): number {
  const m = readFileSync("src/core/webupdate.ts", "utf8").match(/export const WEB_COMPAT = (\d+);/);
  if (!m) throw new Error("WEB_COMPAT not found in src/core/webupdate.ts");
  return Number(m[1]);
}
function versionFile(): Plugin {
  return {
    name: "cv-version",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ src: stamp(), built: built(), compat: webCompat() }) });
    },
  };
}

// The G Squad hub (V1.40, src/squad/hub.ts): the phone app's page reaches its one function over https too.
const SQUAD_HUB = "https://zxhvchchfrkfqxuyorqo.supabase.co";
// PS GOS (the GrapheneOS phone app, ~/Projects/ps/phone): same page, its own entry (src/gos/main.tsx)
// and the same strict CSP as a meta tag (the app also sends it as a header).
function gosEntry(): Plugin {
  return {
    name: "cv-gos",
    transformIndexHtml: { order: "pre", handler(html, ctx) {
      const SB = (loadEnv("gos", process.cwd()).VITE_SUPABASE_URL || "https://mxusokxekkecebwqgeru.supabase.co").replace(/\/+$/, "");
      const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${SB} ${SB.replace("https", "wss")} ${SQUAD_HUB}; worker-src 'self'; frame-src blob: https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'self'`;
      const out = html.replace("/src/main.tsx", "/src/gos/main.tsx").replace(/\s*<link rel="manifest"[^>]*>/, "");
      // Not on the dev server: its hot reload needs inline scripts.
      return ctx.server ? out : out.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    } },
  };
}

// Served at cincee.com/client (proxied) and at <site>.netlify.app/client.
// `vite build --mode ps` builds the same code for the PS Mac app (To-do page only) into dist-ps.
// The one PS version for the Mac and the phone and its keyword (ps-version.json), shown at the top
// of the gear menu, for example "V1.07 · Wisdom".
function psVersion(): { name: string; keyword: string } {
  try {
    const d = JSON.parse(readFileSync("ps-version.json", "utf8"));
    return { name: `V${d.version}`, keyword: d.names?.[d.version] || "" };
  } catch { return { name: "", keyword: "" }; }
}

// The What's new panel (V1.36, views/WhatsNew.tsx): this version's patch notes, bundled into the build, but
// only the words the developer approved (scripts/ps-public.mjs whatsnew checks his approval code; anything else gives no
// notes). Fails closed: if the script cannot run, the build carries no notes and the panel never shows.
// V1.52: `history` is the approved notes of the earlier versions (last 20), so the panel and the update card after a jump
// across several versions show what each skipped version changed (same gate, never private notes).
// `built` lets the page tell an update from a first install (an account with data older than this build ran
// an earlier version).
function psWhatsNew(): { version: string; keyword: string; notes: string[]; code: string; built: string; history: unknown[] } {
  const built = new Date().toISOString();
  try {
    const o = JSON.parse(execFileSync(process.execPath, ["scripts/ps-public.mjs", "whatsnew"], { encoding: "utf8", timeout: 20_000 }));
    const notes = Array.isArray(o.notes) ? o.notes.filter((n: unknown): n is string => typeof n === "string") : [];
    return { version: String(o.version || ""), keyword: String(o.keyword || ""), notes, code: String(o.code || ""), built, history: Array.isArray(o.history) ? o.history : [] };
  } catch { return { version: "", keyword: "", notes: [], code: "", built, history: [] }; }
}

// V1.58 layers (core-root/tools/assemble.mjs, ~/Projects/ps-handover-notes/v158-multidev-design.md): which build this is.
// The assembler writes ps-build.json next to this file (flavour "gsquad" or a person's name, the core and layer commits,
// the full profile and the merged feature registry). Without that file (a full private tree, core's dev server, an
// open-source.mjs build) flavour and profile are null and the code keeps its per account answers, exactly as in V1.57:
// a release made the old way is ONE build for everyone (the developer and friends get the same app), so it must never
// carry one person's profile. Its features are core's shared list only (core-root/features.json here, ../features.json
// in core), never a layer's private list.
// `version` is ps-version.json as it is, so the version claim's extra fields ("by", "kind") reach the page as they are.
type PsBuild = { flavour: string | null; core: string | null; layer: { name: string; owner: string } | null; profile: Record<string, unknown> | null; features: unknown[]; version: Record<string, unknown> | null };
function psBuild(): PsBuild {
  const read = (f: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
  const list = (j: unknown): unknown[] => (Array.isArray(j) ? j : j && typeof j === "object" && Array.isArray((j as { features?: unknown }).features) ? (j as { features: unknown[] }).features : []);
  const b = read("ps-build.json"), v = read("ps-version.json");
  const layer = b?.layer && typeof b.layer === "object" ? b.layer as { name?: unknown; owner?: unknown } : null;
  return {
    flavour: typeof b?.flavour === "string" ? b.flavour : null,
    core: typeof b?.core === "string" ? b.core : null,
    layer: layer ? { name: String(layer.name || ""), owner: String(layer.owner || "") } : null,
    profile: b?.profile && typeof b.profile === "object" ? b.profile as Record<string, unknown> : null,
    features: b ? list(b.features) : list(read(existsSync("core-root/features.json") ? "core-root/features.json" : "../features.json")),
    version: v,
  };
}

// `vite build --mode gos` builds it for PS GOS into dist-gos (bundled inside the phone app).
export default defineConfig(({ mode, command }) => ({
  base: "/client/",
  plugins: [react(), versionFile(), ...(mode === "gos" ? [gosEntry()] : [])],
  define: { __PS_VERSION__: JSON.stringify(psVersion()), __PS_BUILD__: JSON.stringify(psBuild()), __PS_WHATSNEW__: JSON.stringify(psWhatsNew()), __WEB_SRC__: JSON.stringify(command === "build" ? stamp() : ""), __WEB_BUILT__: JSON.stringify(command === "build" ? built() : "") },
  build: { outDir: mode === "ps" ? "dist-ps" : mode === "gos" ? "dist-gos" : "dist/client", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0,
    // The website build also builds G Squad, the mobile web app (todolist-mobile/index.html, src/mobile/), from the same
    // code in the same run, so the two can never drift apart. scripts/postbuild.mjs moves it to cincee.com/todolist-mobile/.
    // Not in the Mac app or the phone APK.
    // V1.44 (src/pages.ts): the website loads its own pages when opened. The Mac app and the phone app keep one file
    // with everything in it, exactly as before (they load from disk, so splitting buys them nothing).
    ...(mode === "ps" || mode === "gos" ? { rollupOptions: { output: { inlineDynamicImports: true } } } : { rollupOptions: { input: { main: "index.html", mobile: "todolist-mobile/index.html" } } }) },
}));
