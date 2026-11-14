// The Client emails step guide (Settings, Client emails): every line a person copies, worked out from THEIR own project
// address and a one time code made here, never a value of anyone else's. Pure, so it is unit tested.
// Nothing in here is secret except the one time code, which only lets the Gmail connect script hand logins to the
// person's own project for one hour.

export const REF_RE = /^[a-z0-9]{20}$/;
export const validRef = (v: unknown): v is string => typeof v === "string" && REF_RE.test(v);
export const functionsUrl = (ref: string) => `https://${ref}.supabase.co/functions/v1`;

/** Step 2: tell the database where the cron jobs call your functions (migration 031, mail_set_project). */
export const setProjectSql = (ref: string) => `select public.mail_set_project('${ref}');`;

/** The one time code: 24 letters and numbers, no look alikes. Random from the browser's own generator. */
export function newCode(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(24))): string {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...bytes].map((b) => A[b % A.length]).join("");
}
export async function sha256Hex(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Step 5, on the Mac: keep the code where the connect script looks. */
export const codeFileCommand = (code: string) => `mkdir -p ~/.ps-gmail && printf '%s' '${code}' > ~/.ps-gmail/enroll-code`;
/** Step 5, in Supabase: only the code's hash goes in, with an expiry of one hour. */
export const enrollSql = (hash: string) => `insert into public.gmail_enroll (code_hash, expires_at) values ('${hash}', now() + interval '1 hour');`;
/** Step 6: sign in each Gmail account read only. `name` is the part before @gmail.com, `file` your downloaded client file. */
export const connectCommand = (ref: string) => `node scripts/gmail-connect.mjs --project ${ref} yourname=/path/to/your-client-file.json`;
/** Instantly (optional): the read only key goes into your own project's Vault, never into PS. */
export const instantlyKeySql = () => `select vault.create_secret('PASTE_YOUR_INSTANTLY_KEY_HERE', 'instantly_api_key');`;
export const webhookSecretSql = () => `select decrypted_secret from vault.decrypted_secrets where name = 'instantly_webhook_secret';`;
export const webhookUrl = (ref: string) => `${functionsUrl(ref)}/instantly-webhook/YOUR_WEBHOOK_SECRET`;
export const deployCommand = (ref: string) =>
  ["gmail-inbox", "instantly-inbox", "instantly-replies", "instantly-webhook"].map((f) => `supabase functions deploy ${f} --no-verify-jwt --project-ref ${ref}`).join("\n");

export interface MailStep { n: number; text: string; code?: string }
/** The steps, one plain sentence each. `code` is what the Copy button copies. `ref` null: the person has not connected a project yet. */
export function mailSteps(ref: string | null, code: string | null, hash: string | null): MailStep[] {
  const r = ref ?? "YOUR_PROJECT_REF";
  return [
    { n: 1, text: "Connect your own Supabase project in Settings, Sync and account, and sign in as its first owner." },
    { n: 2, text: "In your Supabase SQL editor, run PS's migrations 031 to 037 (PS's project setup does this for you), then run this one line.", code: setProjectSql(r) },
    { n: 3, text: "Deploy the four mail functions to your project with the Supabase command line.", code: deployCommand(r) },
    { n: 4, text: "In Google Cloud, make a project, turn on the Gmail API, and make an OAuth client of the type Desktop app, then download its file." },
    { n: 5, text: "Make a one time code, save it on your Mac, and add its hash to your database.", code: code && hash ? `${codeFileCommand(code)}\n${enrollSql(hash)}` : undefined },
    { n: 6, text: "Run the connect script once for each Gmail account, and allow read access on Google's page.", code: connectCommand(r) },
    { n: 7, text: "To send replies, open Reply from PS app on your Mac, press Connect and pick the same client file (your Mac keeps that sign in in its Keychain)." },
    { n: 8, text: "Optional, for Instantly replies: store a read only Instantly key in your Vault, then point an Instantly webhook at your project.", code: `${instantlyKeySql()}\n${webhookSecretSql()}\n${webhookUrl(r)}` },
  ];
}
