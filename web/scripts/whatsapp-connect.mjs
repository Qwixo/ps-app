// Links your WhatsApp Cloud API number to your own project's whatsapp-send function.
// You type the four values from Meta's page here, in this terminal (the typing is hidden), and they go straight to
// your own project with a one time code: the function checks them with Meta, then keeps them in Supabase Vault.
// Nothing is printed, nothing is written to a file, nothing is pasted into a page. Meta's own servers are not called
// from here; your project's function does that.
// Usage: node scripts/whatsapp-connect.mjs --project <your project ref>
//   needs ~/.ps-whatsapp/enroll-code (the one time code whose sha256 is in public.whatsapp_enroll; Settings, WhatsApp settings shows the steps)
//   --unlink  only prints what to do (Settings, WhatsApp settings, Unlink does it from PS)
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const args = process.argv.slice(2);
const at = args.indexOf("--project");
const ref = at >= 0 ? args[at + 1] : "";
const CODE = join(homedir(), ".ps-whatsapp", "enroll-code");
const say = (s) => process.stdout.write(s + "\n");

if (!/^[a-z0-9]{20}$/.test(ref || "")) { say("Add --project <your 20 letter project ref>, from Settings, Sync and account."); process.exit(1); }
if (!existsSync(CODE)) { say("No one time code yet. Make one in Settings, WhatsApp settings, step 5, then run the two lines it shows."); process.exit(1); }

/** One value per line, typed with the echo off (a terminal), or read from a pipe. One reader for all four. */
const quiet = new Writable({ write(_c, _e, cb) { cb(); } });
const rl = createInterface({ input: process.stdin, output: quiet, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
async function ask(label) {
  process.stdout.write(label + ": ");
  const r = await lines.next();
  say("");
  return r.done ? "" : String(r.value).trim();
}

const base = process.env.PS_FUNCTIONS_BASE || `https://${ref}.supabase.co/functions/v1`;   // the override is for tests only
const secrets = {
  access_token: await ask("Access token (system user token)"),
  app_secret: await ask("App secret"),
  phone_number_id: await ask("Phone number ID"),
  waba_id: await ask("WhatsApp Business Account ID"),
};
rl.close();
if (Object.values(secrets).some((v) => !v)) { say("Nothing to send: all four values are needed."); process.exit(1); }
let res;
try {
  res = await fetch(`${base}/whatsapp-send`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "enroll", code: readFileSync(CODE, "utf8").trim(), secrets }), signal: AbortSignal.timeout(30_000) });
} catch { say("Could not reach your project. Check the project ref and that whatsapp-send is deployed."); process.exit(1); }
let j = {};
try { j = await res.json(); } catch { /* not json */ }
if (res.ok && j.ok) { rmSync(CODE, { force: true }); say(`Linked: ${j.number}. The code is used up. Go back to PS and press Test connection.`); process.exit(0); }
say(`Not linked: ${j.error || res.status}`);
process.exit(1);
