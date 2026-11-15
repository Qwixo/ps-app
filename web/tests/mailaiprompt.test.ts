// Run: node --experimental-strip-types tests/mailaiprompt.test.ts
// Copy for your AI (core/mailaiprompt.ts): the prompt holds the project ref when known, works when it is not, names both
// AIs, never holds anything that looks like a key, a token or an address, and has no em or en dash.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const A = await import("../src/core/mailaiprompt.ts");
const S = await import("../src/core/mailsetup.ts");

const REF = "abcdefghijklmnopqrst";
const known = A.mailAiPrompt(REF), unknown = A.mailAiPrompt(null);

ok("the project ref and its address are in the prompt when known, and in the right commands", () => {
  assert.ok(known.includes(`https://${REF}.supabase.co`));
  assert.ok(known.includes(`Project ref: ${REF}`) || known.includes(`My project ref: ${REF}`));
  assert.ok(known.includes(S.setProjectSql(REF)));
  for (const line of S.deployCommand(REF).split("\n")) assert.ok(known.includes(line), line);
  assert.ok(known.includes(`--project ${REF} `), "the connect script gets the ref");
  assert.ok(known.includes(`https://supabase.com/dashboard/project/${REF}/sql/new`));
  assert.ok(known.includes(`${S.functionsUrl(REF)}/instantly-webhook/<the secret>`));
});
ok("when the project is not known yet it still works: asks for the ref, no fake value, no empty command", () => {
  assert.match(unknown, /does not know my Supabase project yet/);
  assert.match(unknown, /Settings, Sync and account/);
  assert.ok(!unknown.includes("supabase.co/functions/v1/instantly-webhook/<the secret>") || unknown.includes("<my project ref>"));
  assert.ok(unknown.includes("--project <my project ref> "));
  assert.ok(unknown.includes("--project-ref <my project ref>"));
  assert.ok(!/undefined|null|\bNaN\b|\[object/.test(unknown));
  for (const bad of ["", "ABC", "short", "abcdefghijklmnopqrs!", undefined as unknown as null]) assert.ok(!A.mailAiPrompt(bad).includes("supabase.co/dashboard"), String(bad));
});
ok("it names both Claude Code and Codex, and says the person does the Google click", () => {
  for (const p of [known, unknown]) {
    assert.match(p, /Claude Code/); assert.match(p, /Codex/);
    assert.match(p, /Google's Allow click is always mine/);
    assert.match(p, /never type my passwords/);
    assert.match(p, /Keychain/);
  }
});
ok("nothing that looks like a key, a token, a secret value or an address", () => {
  for (const p of [known, unknown]) {
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(p), "an address");
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(p), "a jwt");
    const shapes = [["s", "k-"], ["sb_", "secret_"], ["sb_", "publishable_"], ["gh", "p_"], ["github_", "pat_"], ["AK", "IA"], ["BEGIN ", "PRIVATE"], ["ya", "29."], ["GOC", "SPX"]].map((x) => x.join(""));
    for (const w of shapes) assert.ok(!p.includes(w), `a key shape ${w}`);
    assert.ok(!/\b[A-Za-z0-9_-]{40,}\b/.test(p.replace(/https?:\/\/\S+/g, "")), "a long random string");
    assert.ok(!/\/Users\//.test(p), "a personal path");
  }
  assert.ok(known.includes("PASTE_YOUR_INSTANTLY_KEY_HERE"), "the Instantly key stays a placeholder");
});
ok("no em or en dash, short numbered steps 1 to 9 in order", () => {
  for (const p of [known, unknown]) {
    assert.ok(!/[–—]/.test(p));
    const nums = [...p.matchAll(/^(\d)\. /gm)].map((m) => Number(m[1]));
    assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }
  assert.ok(known.length < 9000, "short enough to paste");
});
ok("every file and script the prompt names exists in the repo", () => {
  for (const f of ["scripts/gmail-connect.mjs", "supabase/migrations/031_gmail_inbox.sql", "supabase/migrations/037_instantly_replies_cron.sql", "supabase/functions/gmail-inbox/index.ts"]) assert.ok(file(f).length > 0, f);
  assert.match(file("supabase/functions/gmail-inbox/index.ts"), /gmail_enroll/);
});
ok("the words: one button, a confirmation line, a small by hand link, no dashes", () => {
  assert.deepEqual(A.AI_COPY_WORDS, {
    button: "Copy for your AI",
    line: "Copies everything your AI needs to connect your Gmail to PS. Paste it into Claude Code or Codex.",
    done: "Copied. Paste it into Claude Code or Codex.",
    failed: "Could not copy. Try again, or use Do it by hand instead.",
    hand: "Do it by hand instead",
  });
  for (const f of ["src/core/mailaiprompt.ts", "src/views/CopyForAi.tsx", "src/views/ClientEmailsSettings.tsx"]) assert.ok(!/[–—]/.test(file(f)), f);
});
ok("the button sits in Settings, Client emails and in the email panel's not connected state; the old steps stay behind the link", () => {
  const ce = file("src/views/ClientEmailsSettings.tsx");
  assert.match(ce, /<CopyForAiButton/); assert.match(ce, /mailSteps\(ref, code, hash\)/); assert.match(ce, /<details className="stack tight ce-hand">/);
  assert.ok(!/<details[^>]*\bopen=/.test(ce), "the by hand steps never open by themselves");
  assert.match(file("src/views/TaskMap.tsx"), /<CopyForAiButton className="tm-meet-j tm-mail-copy" \/>/);
});
ok("step 6 is run by the person in their own Terminal (it waits for a Google sign in the AI cannot see)", () => {
  const p = A.mailAiPrompt("abcdefghijklmnopqrst");
  const step6 = p.split("\n").find((l) => l.startsWith("6. "))!;
  assert.match(step6, /my own Terminal/);
  assert.match(step6, /Wait until I say it is done/);
  assert.match(step6, /gmail-connect\.mjs --project abcdefghijklmnopqrst/);
});

console.log(`${n} passed`);
