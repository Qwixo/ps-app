#!/usr/bin/env node
// V1.61: the app's Resources/ps-build.json for a build made the old way (no assembled ps-build.json above this folder).
//
//   node tools/bundle-features.mjs <web dir> <out file>
//
// Writes { flavour: null, core: null, layer: null, profile: null, features: [...] }: core's shared feature list only,
// exactly what the page gets in such a build (web vite.config.ts psBuild), and NO profile, because a build
// made the old way is one app for everyone. Sources/Features.swift reads "features", so Features.on knows every id and
// core's defaults from the first launch; friends' features stay off until the page has said who is signed in (then the
// page's stored answer decides, also on the next launch). Without this file the app had no registry at all.
// The list: <web dir>/core-root/features.json (the private tree), else <web dir>/../features.json (core's layout).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [web, out] = process.argv.slice(2);
if (!web || !out) { console.error("bundle-features: usage: node tools/bundle-features.mjs <web dir> <out file>"); process.exit(2); }
const src = [join(web, "core-root/features.json"), join(web, "../features.json")].find((f) => existsSync(f));
let features = [];
if (src) {
  const j = JSON.parse(readFileSync(src, "utf8"));
  if (j && j.schema === 1 && Array.isArray(j.features)) features = j.features;
  else { console.error(`bundle-features: STOP, ${src} is not a feature registry ({schema: 1, features: [...]})`); process.exit(1); }
} else console.error("bundle-features: no core features.json found; the app gets an empty registry");
writeFileSync(out, JSON.stringify({ flavour: null, core: null, layer: null, profile: null, features }, null, 2) + "\n");
console.log(`bundle-features: ${features.length} features from ${src ?? "nowhere"}`);
