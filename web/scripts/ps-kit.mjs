// Packs what a personal PS Supabase project needs (supabase/ps-core.json) into a folder the Mac app carries:
// ps-mac build.sh runs `node scripts/ps-kit.mjs <PS.app>/Contents/Resources/project-kit`. PS's setup
// (ps-mac Sources/ProjectSetup.swift) reads kit.json from there, applies the migrations in order and
// deploys the functions on a project someone linked themselves. Only files inside the signed app are used.
// kit.json lists every file with its SHA-256, and "kit" is one fingerprint of them all (PS compares it to
// the one it last applied, to know when an update brought something new).
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (b) => createHash("sha256").update(b).digest("hex");

export function readManifest() {
  return JSON.parse(readFileSync(join(ROOT, "supabase/ps-core.json"), "utf8"));
}

/** The kit description, without writing anything (tests use it too). */
export function kit() {
  const m = readManifest();
  const migrations = m.migrations.map((f) => {
    const mt = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(f);
    if (!mt) throw new Error(`ps-kit: odd migration name ${f}`);
    const body = readFileSync(join(ROOT, "supabase/migrations", f));
    return { version: mt[1], name: mt[2], file: `migrations/${f}`, sha256: sha(body) };
  });
  const functions = m.functions.map((fn) => {
    if (!/^[a-z0-9-]{1,40}$/.test(fn.slug)) throw new Error(`ps-kit: odd function name ${fn.slug}`);
    const files = fn.files.map((f) => ({ path: f, file: `functions/${fn.slug}/${f}`, sha256: sha(readFileSync(join(ROOT, "supabase/functions", fn.slug, f))) }));
    return { slug: fn.slug, entry: fn.entry, verify_jwt: !!fn.verify_jwt, secrets: fn.secrets || [], files, sha256: sha(files.map((x) => x.path + ":" + x.sha256).join("\n")) };
  });
  const all = [...migrations.map((x) => x.file + ":" + x.sha256), ...functions.map((f) => f.slug + ":" + f.sha256)].join("\n");
  return { format: 1, kit: sha(all).slice(0, 16), migrations, functions };
}

export function writeKit(out) {
  const k = kit();
  rmSync(out, { recursive: true, force: true });
  for (const x of k.migrations) {
    mkdirSync(dirname(join(out, x.file)), { recursive: true });
    copyFileSync(join(ROOT, "supabase", x.file), join(out, x.file));
  }
  for (const fn of k.functions) for (const f of fn.files) {
    mkdirSync(dirname(join(out, f.file)), { recursive: true });
    copyFileSync(join(ROOT, "supabase", f.file), join(out, f.file));
  }
  writeFileSync(join(out, "kit.json"), JSON.stringify(k, null, 1));
  return k;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node scripts/ps-kit.mjs <folder>"); process.exit(2); }
  const k = writeKit(out);
  console.log(`ps-kit: ${k.migrations.length} migrations, ${k.functions.length} function(s), kit ${k.kit}`);
}
