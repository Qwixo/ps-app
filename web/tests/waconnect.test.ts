// Run: node --experimental-strip-types tests/waconnect.test.ts
// scripts/whatsapp-connect.mjs: asks for a project ref and a one time code, reads the four values from the terminal,
// sends them only to the person's own project function (here a FAKE local one), prints no value and keeps no file.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pswac-"));
const run = (args: string[], env: Record<string, string>, input = "") => new Promise<{ out: string; code: number | null }>((res) => {
  const p = spawn(process.execPath, ["scripts/whatsapp-connect.mjs", ...args], { env: { ...process.env, HOME: home, ...env } });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.stdin.end(input);
  p.on("close", (code) => res({ out, code }));
});
const REF = "abcdefghijklmnopqrst";

const a = await run([], {});
assert.match(a.out, /Add --project/); assert.equal(a.code, 1);
const b = await run(["--project", REF], {});
assert.match(b.out, /No one time code yet/); assert.equal(b.code, 1);
console.log("ok - asks for the ref and the code first");

mkdirSync(join(home, ".ps-whatsapp"));
writeFileSync(join(home, ".ps-whatsapp", "enroll-code"), "fakecode123\n");
let got: any = null;
const srv = createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => { got = { url: req.url, body: JSON.parse(body) }; res.writeHead(200); res.end(JSON.stringify({ ok: true, number: "+1 555 000 1111" })); });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as { port: number }).port;
const c = await run(["--project", REF], { PS_FUNCTIONS_BASE: `http://127.0.0.1:${port}` }, "TOK-FAKE\nSECRET-FAKE\n111222333\n444555666\n");
srv.close();
assert.equal(c.code, 0, c.out);
assert.equal(got.url, "/whatsapp-send");
assert.deepEqual(got.body, { op: "enroll", code: "fakecode123", secrets: { access_token: "TOK-FAKE", app_secret: "SECRET-FAKE", phone_number_id: "111222333", waba_id: "444555666" } });
assert.ok(!/TOK-FAKE|SECRET-FAKE/.test(c.out), "no value is ever printed");
assert.ok(!existsSync(join(home, ".ps-whatsapp", "enroll-code")), "the one time code is used up");
assert.deepEqual(readdirSync(join(home, ".ps-whatsapp")), [], "no secret file is left behind");
console.log("ok - sends the four values once to the own project and keeps nothing");

mkdirSync(join(home, ".ps-whatsapp"), { recursive: true });
writeFileSync(join(home, ".ps-whatsapp", "enroll-code"), "x");
const d = await run(["--project", REF], { PS_FUNCTIONS_BASE: "http://127.0.0.1:1" }, "a\nb\nc\nd\n");
assert.equal(d.code, 1); assert.match(d.out, /Could not reach your project/);
const e = await run(["--project", REF], { PS_FUNCTIONS_BASE: "http://127.0.0.1:1" }, "a\n\n\n\n");
assert.match(e.out, /all four values are needed/);
console.log("ok - unreachable project and empty values stop with a plain sentence");
