// Run: node --experimental-strip-types tests/fitness-fixture.test.ts
// The Mac self test area "fitness" (ps-mac FitnessSelfTest.swift) makes fresh FICTIONAL data with plain node
// (scripts/fitness-fixture.ts, which imports src/dev/fitness-fake.ts) and silently keeps the old file when that fails.
// From 7 Nov to 13 Nov 2026 it failed (an import without ".ts"), so the open workout in the old file was days old and
// the live and history pictures showed the Today page. This loads the same chain the same way, so it can not break quietly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };

await ok("the fake Fitness data loads in plain node (every import has its .ts) and has a program and past workouts", async () => {
  const F = await import("../src/dev/fitness-fake.ts");
  const today = new Date().toISOString().slice(0, 10);
  const docs = F.fitnessFakeDocs(today) as { kind: string; data: { date?: string } }[];
  assert.ok(docs.some((d) => d.kind === "fprog"), "a program");
  assert.ok(docs.filter((d) => d.kind === "fwork").length >= 5, "past workouts for History");
});
await ok("the generator's own imports are plain node too", () => {
  const src = readFileSync(new URL("../scripts/fitness-fixture.ts", import.meta.url), "utf8");
  for (const m of src.matchAll(/from "(\.[^"]+)"/g)) assert.match(m[1], /\.ts$/, m[1]);
  const fake = readFileSync(new URL("../src/dev/fitness-fake.ts", import.meta.url), "utf8");
  for (const m of fake.matchAll(/^import (?!type)[^;]*from "(\.[^"]+)"/gm)) assert.match(m[1], /\.ts$/, m[1]);
});
console.log(`\n${n} fitness fixture tests passed`);
