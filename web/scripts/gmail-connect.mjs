// Connects your Gmail accounts to your own project's gmail-inbox function with READ-ONLY access.
// It prints one Google consent link per account (loopback + PKCE) to open in the browser profile that holds that
// account, receives a gmail.readonly refresh token and sends it straight to the gmail-inbox "enroll" endpoint
// with a one-time code. Tokens are never printed. While the run is in progress they sit in ~/.ps-gmail/pending.json
// (0600) so a failed run can resume; that file is deleted once Supabase has them.
// Usage: node scripts/gmail-connect.mjs --project <your project ref> <name>=<path to your Google Cloud OAuth client file> [...]
//   <name> is the part before @gmail.com. The client file is the JSON you download from Google Cloud (Desktop app type).
//   For a Google Workspace address use --address <full address> instead of a bare name (name=path stays for gmail.com).
// Needs ~/.ps-gmail/enroll-code (one-time code whose sha256 is in public.gmail_enroll; Settings, Client emails shows the steps).
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const HOME = homedir();
const DIR = join(HOME, ".ps-gmail");
const PENDING = join(DIR, "pending.json");

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const save = (obj) => { mkdirSync(DIR, { recursive: true, mode: 0o700 }); writeFileSync(PENDING, JSON.stringify(obj), { mode: 0o600 }); };
const load = () => (existsSync(PENDING) ? JSON.parse(readFileSync(PENDING, "utf8")) : {});

function oauthClient(path) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  const c = j.installed || j.web;
  return { client_id: c.client_id, client_secret: c.client_secret };
}

// Starts a loopback listener for one account and returns its consent URL plus a promise that
// settles when Google redirects back. Nothing is opened automatically: you paste each link into
// the browser profile that holds that account.
async function prepare(name, client) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const hint = `${name}@gmail.com`;
  let resolveCode, rejectCode;
  const got = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/cb") { res.writeHead(404).end(); return; }
    const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      `<body style="font:16px system-ui;padding:40px;color:#1B1A1D"><h2 style="color:#C8366B">${ok ? "Connected" : "Not connected"}: ${hint}</h2><p>You can close this tab.</p></body>`,
    );
    srv.close();
    if (ok) resolveCode(u.searchParams.get("code"));
    else rejectCode(new Error(u.searchParams.get("error") || "state mismatch"));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${srv.address().port}/cb`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirect, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent select_account", login_hint: hint,
    state, code_challenge: challenge, code_challenge_method: "S256",
  }).toString();

  const done = (async () => {
    const code = await got;
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier, ...client }),
    });
    const j = await r.json();
    if (!j.refresh_token) throw new Error(`no refresh token (${j.error || r.status})`);
    if (!String(j.scope).includes(SCOPE)) throw new Error("read access was not granted");
    const p = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${j.access_token}` } }).then((x) => x.json());
    const email = String(p.emailAddress || "").toLowerCase();
    if (!email) throw new Error("could not read the account address");
    return { email, ...client, refresh_token: j.refresh_token };
  })();
  return { url: auth.toString(), done, close: () => srv.close() };
}

const TIMEOUT_MIN = 20;
const args = process.argv.slice(2);
const pi = args.indexOf("--project");
const REF = pi >= 0 ? String(args[pi + 1] || "") : "";
if (!/^[a-z0-9]{20}$/.test(REF)) { console.log("Add --project <your project ref> (20 letters and numbers, from your Supabase address)."); process.exit(1); }
const FN = `https://${REF}.supabase.co/functions/v1/gmail-inbox`;
const ACCOUNTS = {};
args.forEach((x, i) => { if (i === pi || i === pi + 1 || x.startsWith("--")) return; const k = x.indexOf("="); if (k > 0) ACCOUNTS[x.slice(0, k)] = x.slice(k + 1); });
if (!Object.keys(ACCOUNTS).length) { console.log("Add at least one <name>=<path to your OAuth client file>."); process.exit(1); }
const wanted = Object.keys(ACCOUNTS);
const pending = load();
const fallback = [];
const have = new Set(Object.values(pending).map((v) => v.email));
const todo = wanted.filter((n) => ACCOUNTS[n] && !have.has(`${n}@gmail.com`));
for (const n of wanted) if (have.has(`${n}@gmail.com`)) console.log(`${n}: already signed in, skipping`);

if (todo.length && !useConnector) {
  const runs = [];
  for (const name of todo) runs.push({ name, ...(await prepare(name, oauthClient(ACCOUNTS[name]))) });
  console.log(`\nOpen each link in the browser profile that is signed in to that account.`);
  console.log(`Pick the account named, click Advanced > Go to app if Google warns, and allow read access.\n`);
  runs.forEach((r, i) => console.log(`${i + 1}. ${r.name}@gmail.com\n${r.url}\n`));
  console.log(`Waiting up to ${TIMEOUT_MIN} minutes. Press Enter once you are done .\n`);
  let enterPressed;
  const enter = new Promise((res) => { enterPressed = res; });
  process.stdin.once("data", () => enterPressed());
  const timer = setTimeout(() => runs.forEach((r) => r.close()), TIMEOUT_MIN * 60_000);
  await Promise.race([enter, Promise.allSettled(runs.map((r) => r.done))]);
  await Promise.all(runs.map(async (r) => {
    try {
      const acct = await Promise.race([r.done, new Promise((_, rej) => setTimeout(() => rej(new Error("not signed in")), 1500))]);
      const want = `${r.name}@gmail.com`;
      if (acct.email !== want) console.log(`[${r.name}] Note: you signed in as ${acct.email}, not ${want}.`);
      pending[acct.email.replace(/@.*/, "")] = acct;
      save(pending);
      console.log(`[${r.name}] OK (${acct.email})`);
    } catch (e) {
      console.log(`[${r.name}] ${e.message}`);
    }
  }));
  clearTimeout(timer);
  runs.forEach((r) => r.close());
  process.stdin.pause();
}

const list = Object.values(pending);
if (!list.length) { console.log("\nNothing to send."); process.exit(1); }
const codeFile = join(DIR, "enroll-code");
if (!existsSync(codeFile)) { console.log(`\nMissing ${codeFile}. Settings, Client emails, step 3 shows how to make one.`); process.exit(1); }
const res = await fetch(FN, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "enroll", code: readFileSync(codeFile, "utf8").trim(), accounts: list, allowWrite: fallback }),
});
const out = await res.json().catch(() => ({}));
console.log("\nSupabase says:");
for (const a of out.accounts || []) console.log(`  ${a.ok ? "OK  " : "FAIL"} ${a.email}${a.error ? `  (${a.error})` : ""}`);
if (!out.ok) { console.log(`  ${out.error || "nothing stored"}`); process.exit(1); }
// Supabase holds them now; drop the local copy of every login it accepted.
const okEmails = new Set((out.accounts || []).filter((a) => a.ok).map((a) => a.email));
for (const [k, v] of Object.entries(pending)) if (okEmails.has(v.email)) delete pending[k];
if (Object.keys(pending).length) save(pending); else rmSync(PENDING, { force: true });
rmSync(codeFile, { force: true });
console.log("\nDone. New mail is checked every 2 minutes.");
