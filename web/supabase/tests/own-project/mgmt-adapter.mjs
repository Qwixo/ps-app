// End to end test helper for "Connect your own Supabase" (5 Nov 2026). LOCAL ONLY.
// A stand in for api.supabase.com on 127.0.0.1 that drives a LOCAL Supabase (supabase start, under Colima):
// SQL goes to the local database through psql inside its container, a deployed function's files are written
// into the local project's supabase/functions folder (where `supabase functions serve` picks them up).
// PS's real setup code (ps-mac tests/project-e2e.swift, the same Swift files the app uses) talks to it.
// It never talks to any real Supabase service.
//   node supabase/tests/own-project/mgmt-adapter.mjs <local project folder> <db container> <anon key> [port]
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, container, anon, port = "54400"] = process.argv.slice(2);
if (!dir || !container || !anon) { console.error("usage: mgmt-adapter.mjs <project folder> <db container> <anon key> [port]"); process.exit(2); }
const REF = "abcdefghijklmnopqrst";
let made = false, polls = 0, dbSchema = "public, graphql_public";
const log = [];

function psql(sql) {
  try {
    const out = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-1", "-v", "ON_ERROR_STOP=1",
      "-A", "-F", "\x1f", "-P", "footer=off"], { input: sql, stdio: ["pipe", "pipe", "pipe"] }).toString();
    const lines = out.split("\n").filter((l) => l.length);
    if (!lines.length) return { ok: true, rows: [] };
    const head = lines[0].split("\x1f");
    const conv = (v) => v === "t" ? true : v === "f" ? false : /^-?(0|[1-9]\d*)$/.test(v) ? Number(v) : v;
    return { ok: true, rows: lines.slice(1).map((l) => Object.fromEntries(l.split("\x1f").map((v, i) => [head[i], conv(v)]))) };
  } catch (e) {
    return { ok: false, message: String(e.stderr || e.message).split("\n").find((l) => /ERROR/.test(l)) || "query failed" };
  }
}

function multipart(body, type) {
  const b = /boundary=(.+)$/.exec(type)?.[1];
  const parts = body.toString("latin1").split("--" + b).slice(1, -1);
  return parts.map((p) => {
    const [head, ...rest] = p.replace(/^\r\n/, "").split("\r\n\r\n");
    const data = Buffer.from(rest.join("\r\n\r\n").replace(/\r\n$/, ""), "latin1");
    return { name: /name="([^"]+)"/.exec(head)?.[1], filename: /filename="([^"]+)"/.exec(head)?.[1], data };
  });
}

const send = (res, status, json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(json)); };

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    log.push(`${req.method} ${p}`);
    if (!/^Bearer sbp_[A-Za-z0-9_]{20,}$/.test(req.headers.authorization || "")) return send(res, 401, { message: "Unauthorized" });
    if (req.method === "GET" && p === "/v1/organizations") return send(res, 200, [{ id: "local", slug: "local", name: "Local test" }]);
    if (req.method === "GET" && p === "/v1/projects") return send(res, 200, made ? [{ ref: REF, name: "ps-vault", organization_slug: "local", region: "local", status: "ACTIVE_HEALTHY" }] : []);
    if (req.method === "POST" && p === "/v1/projects") {
      const j = JSON.parse(body.toString());
      if (j.name !== "ps-vault" || !j.db_pass || j.db_pass.length < 30) return send(res, 400, { message: "bad create" });
      made = true;
      return send(res, 201, { ref: REF, id: REF, name: j.name, organization_slug: j.organization_slug, region: "local", status: "COMING_UP" });
    }
    if (req.method === "GET" && p === `/v1/projects/${REF}`) return send(res, 200, { ref: REF, name: "ps-vault", status: ++polls > 1 ? "ACTIVE_HEALTHY" : "COMING_UP" });
    // The Data API's schema list (7 Nov 2026, PS in its own schema ps). The local config.toml must already list ps.
    if (req.method === "GET" && p === `/v1/projects/${REF}/postgrest`) return send(res, 200, { db_schema: dbSchema });
    if (req.method === "PATCH" && p === `/v1/projects/${REF}/postgrest`) { dbSchema = String(JSON.parse(body.toString() || "{}").db_schema || dbSchema); log.push(`db_schema=${dbSchema}`); return send(res, 200, { db_schema: dbSchema }); }
    if (req.method === "GET" && p === `/v1/projects/${REF}/functions`) return send(res, 200, []);
    if (req.method === "GET" && p === `/v1/projects/${REF}/api-keys`) return send(res, 200, [{ name: "anon", api_key: anon, type: "legacy" }]);
    if (req.method === "POST" && p === `/v1/projects/${REF}/database/query`) {
      const r = psql(JSON.parse(body.toString()).query);
      return r.ok ? send(res, 201, r.rows) : send(res, 400, { message: r.message });
    }
    if (req.method === "POST" && p === `/v1/projects/${REF}/functions/deploy`) {
      const slug = u.searchParams.get("slug");
      const parts = multipart(body, req.headers["content-type"] || "");
      const meta = JSON.parse(parts.find((x) => x.name === "metadata")?.data.toString() || "{}");
      if (!/^[a-z0-9-]+$/.test(slug || "") || meta.name !== slug) return send(res, 400, { message: "bad deploy" });
      const fdir = join(dir, "supabase", "functions", slug);
      mkdirSync(fdir, { recursive: true });
      for (const f of parts.filter((x) => x.name === "file")) {
        if (!/^[A-Za-z0-9_.-]+$/.test(f.filename)) return send(res, 400, { message: "bad file" });
        writeFileSync(join(fdir, f.filename), f.data);
      }
      writeFileSync(join(dir, "deployed.json"), JSON.stringify({ slug, meta }));
      return send(res, 201, { slug, status: "ACTIVE", verify_jwt: meta.verify_jwt });
    }
    return send(res, 404, { message: `no route ${req.method} ${p}` });
  });
}).listen(Number(port), "127.0.0.1", () => console.log(`mgmt adapter on 127.0.0.1:${port}`));
process.on("SIGTERM", () => { writeFileSync(join(dir, "adapter-log.json"), JSON.stringify(log)); process.exit(0); });
