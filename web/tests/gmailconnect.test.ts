// Run: node --experimental-strip-types tests/gmailconnect.test.ts
// The Gmail connect script must run its first steps without a crash, offline: it asks for a link, finds no sign in,
// and stops before it would ever call the network (review fix: it used a variable that no longer existed).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "psgc-"));
const client = join(dir, "client.json");
writeFileSync(client, JSON.stringify({ installed: { client_id: "fake-id", client_secret: "fake-secret" } }));
const run = (args: string[]) => spawnSync(process.execPath, ["scripts/gmail-connect.mjs", ...args], { env: { ...process.env, HOME: dir }, input: "\n", encoding: "utf8", timeout: 15000 });

const bad = run(["x=" + client]);
assert.match(bad.stdout, /Add --project/, "a missing project ref is explained");
assert.equal(bad.status, 1);

const r = run(["--project", "abcdefghijklmnopqrst", "pat=" + client]);
assert.ok(!/ReferenceError|is not defined/.test(r.stderr), "no crash from a missing variable: " + r.stderr.slice(0, 200));
assert.match(r.stdout, /Open each link/, "it prints the sign in step");
assert.match(r.stdout, /Nothing to send/, "with no sign in it stops before any network call");
assert.equal(r.status, 1);
console.log("ok - gmail-connect runs its first steps offline");
