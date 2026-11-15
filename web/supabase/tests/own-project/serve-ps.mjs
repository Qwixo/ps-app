// End to end test helper, LOCAL ONLY: serves the PS web build (dist-ps) at http://localhost:4173/client/ the
// way the Mac app does, including the project hand in: PS puts window.__psProject in place before the page's
// own code runs (ps-mac Sources/Project.swift pageScript). Here a small script file does that, pointing the
// real web code at a LOCAL Supabase. The page then runs exactly as in PS, minus the native shell.
//   node supabase/tests/own-project/serve-ps.mjs <dist-ps folder> <local supabase url> <anon key> [setup code]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const [dist, url, key, setupCode, schema] = process.argv.slice(2);   // schema: "ps" for a project shared with another app
if (!dist || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url || "") || !key) { console.error("local only: serve-ps.mjs <dist-ps> http://127.0.0.1:<port> <anon key> [setup code]"); process.exit(2); }
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const project = `Object.defineProperty(window,'__psProject',{value:Object.freeze(${JSON.stringify({ url, key, ...(setupCode && setupCode !== "-" ? { setupCode } : {}), ...(schema === "ps" ? { schema } : {}) })}),writable:false,configurable:false});`;
// The same policy as the Mac app's page (pageCSP in ps-mac Sources/Project.swift), for this one project.
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.giphy.com; connect-src 'self' ${url} ${url.replace("http", "ws")}; worker-src 'self'; manifest-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'`;

createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/client/__ps_project.js") { res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }); return res.end(project); }
  if (!p.startsWith("/client")) { res.writeHead(302, { Location: "/client/" }); return res.end(); }
  let rel = normalize(p.slice("/client".length)).replace(/^\/+/, "");
  let file = join(dist, rel);
  if (!file.startsWith(dist) || !rel || !existsSync(file) || statSync(file).isDirectory()) {
    if (rel.includes(".")) { res.writeHead(404); return res.end("Not found"); }
    file = join(dist, "index.html");
  }
  let body = readFileSync(file);
  const head = { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" };
  if (file.endsWith("index.html")) {
    body = Buffer.from(body.toString().replace(/<script type="module"/, `<script src="/client/__ps_project.js"></script>\n    <script type="module"`));
    head["Content-Security-Policy"] = csp;
  }
  res.writeHead(200, head);
  res.end(body);
}).listen(4173, "127.0.0.1", () => console.log("PS web on http://localhost:4173/client/ (local Supabase " + url + ")"));
