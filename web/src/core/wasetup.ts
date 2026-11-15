// The WhatsApp link guide (Settings, WhatsApp settings, Link WhatsApp) and its live example. Pure, so it is unit tested.
// Written from Meta's current docs (read 14 Nov 2026, links in the pull request report). Every line a person copies is worked
// out from THEIR own project; nothing here is secret except the one time code, which only lets the connect script hand the
// four Meta values to the person's own project for one hour.
// What Meta says that shapes the steps: the Cloud API needs a number that is not already in a WhatsApp account; keeping the
// WhatsApp Business app on the same number (coexistence) is offered through Embedded Signup, which is for Tech Providers and
// Solution Partners, so one person on their own project cannot use it; the access token must be a permanent system user token;
// the app must be Live for webhooks to arrive; since 1 Oct 2026 replies inside the 24 hour window are free only for the first
// 1,000 a month on each number, then charged, and need a payment method in Meta.
import { functionsUrl } from "./mailsetup.ts";

export type Which = "normal" | "business" | "unsure";
export const WHICH: { id: Which; name: string; line: string }[] = [
  { id: "normal", name: "Normal WhatsApp", line: "The green app everyone has." },
  { id: "business", name: "WhatsApp Business", line: "The green app with a B, for shops and companies." },
  { id: "unsure", name: "Not sure", line: "Open WhatsApp: a B on its icon and a Business profile mean WhatsApp Business." },
];

/** What the answer means, in plain words (step 1 shows it right under the choice). */
export function whichAnswer(w: Which | null): string {
  if (w === "normal") return "Meta does not let one number be in the normal app and in PS at once. Use a second number for PS (a cheap SIM or eSIM). Your normal WhatsApp stays exactly as it is.";
  if (w === "business") return "Meta lets the Business app and the API share one number only through approved partners, which your own project is not. So use a second number for PS. Your WhatsApp Business app stays as it is.";
  if (w === "unsure") return "If the app icon has a B or a shop look, it is WhatsApp Business. Either way PS needs a second number, so pick whichever you have and carry on.";
  return "";
}

export const META_APPS = "https://developers.facebook.com/apps/";
export const META_BUSINESS = "https://business.facebook.com/settings/system-users";
export const META_DOCS = "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started";

export const webhookUrl = (ref: string) => `${functionsUrl(ref)}/whatsapp-webhook`;
export const codeFileCommand = (code: string) => `mkdir -p ~/.ps-whatsapp && printf '%s' '${code}' > ~/.ps-whatsapp/enroll-code`;
export const enrollSql = (hash: string) => `insert into public.whatsapp_enroll (code_hash, expires_at) values ('${hash}', now() + interval '1 hour');`;
export const connectCommand = (ref: string) => `node scripts/whatsapp-connect.mjs --project ${ref}`;
export const deployCommand = (ref: string) => ["whatsapp-webhook", "whatsapp-send"].map((f) => `supabase functions deploy ${f} --no-verify-jwt --project-ref ${ref}`).join("\n");

export interface WaStep { n: number; text: string; code?: string; link?: { label: string; href: string }; live?: "linked" | "verified" | "message"; button?: "code" }
export const PRIVACY_LINE = "Messages go through Meta's servers to your own Supabase project, where PS seals them so only you can read them.";

export function waSteps(o: { ref: string | null; which: Which | null; code: string | null; hash: string | null; verifyToken: string | null }): WaStep[] {
  const r = o.ref ?? "YOUR_PROJECT_REF";
  return [
    { n: 1, text: "Pick which WhatsApp you use. PS needs a second number either way." },
    { n: 2, text: "Make a Meta app with the use case Connect with customers through WhatsApp, in a business portfolio of yours.", link: { label: "Open Meta apps", href: META_APPS } },
    { n: 3, text: "In the app, open WhatsApp, API setup, and add your second number. Meta sends it a code by text or call." },
    { n: 4, text: "Make a permanent token: in Business settings add a system user, give it your app and number, and make a token with whatsapp_business_messaging and whatsapp_business_management.", link: { label: "Open system users", href: META_BUSINESS } },
    { n: 5, text: "Keep four values at hand: the token, the app secret (App settings, Basic), the Phone number ID and the WhatsApp Business Account ID (both on API setup)." },
    { n: 6, text: "In your Supabase, run PS's migration 041 (PS's project setup does it) and deploy the two WhatsApp functions.", code: deployCommand(r) },
    { n: 7, text: "Make a one time code, save it on your Mac, and add its hash to your database.", button: "code", code: o.code && o.hash ? `${codeFileCommand(o.code)}\n${enrollSql(o.hash)}` : undefined },
    { n: 8, text: "Run the connect script and type the four values when it asks. They go straight to your own project and into its Vault, never into PS.", code: connectCommand(r), live: "linked" },
    { n: 9, text: "In Meta, WhatsApp, Configuration, paste this address and this verify token, press Verify and save, then switch on the messages field.", code: `${webhookUrl(r)}\n${o.verifyToken ?? "(your verify token shows here once you are signed in as the first owner)"}`, live: "verified" },
    { n: 10, text: "In Meta, switch the app to Live mode and add a payment method in Billing. Replies are free for the first 1,000 a month on a number, then Meta charges per message." },
    { n: 11, text: "Send yourself a WhatsApp message from another phone to the PS number. When it lands here, you are linked.", live: "message" },
  ];
}

// ---------- the live example (marked "Example", made up names, sends nothing) ----------
export const DEMO = {
  wa: { who: "Sam, Glow Studio", msg: "Hi, can we move our call to Friday?", quick: "Sure, Friday works. Talk then." },
  mail: { who: "Pat Example, Harbor Fitness", subject: "Invoice question", msg: "Could you resend the invoice from last week?", quick: "Of course, sending it over now." },
  /** Milliseconds for each beat; the whole loop, then a pause. */
  t: { waIn: 0, waPoint: 1100, waBox: 1700, waQuick: 2600, waType: 3000, waSend: 3900, waSent: 4400, waRead: 5600, mailIn: 6800, mailPoint: 7900, mailBox: 8400, mailQuick: 9200, mailSend: 10300, mailSent: 10800, end: 12800 },
} as const;
export type DemoPhase = "wa" | "mail";
export interface DemoState {
  phase: DemoPhase;
  card: boolean;                // the notification is showing
  pointer: "none" | "reply" | "quick" | "send";   // where the animated pointer clicks now
  box: boolean;                 // the reply box is open
  typed: string;                // what is in the box
  ticks: "none" | "sending" | "sent" | "read";
  mailSent: boolean;
}
/** What the example shows `at` milliseconds into its loop. Pure: the view only draws it. */
export function demoState(at: number): DemoState {
  const t = DEMO.t, ms = ((at % t.end) + t.end) % t.end;
  if (ms < t.mailIn) {
    const w = DEMO.wa;
    return { phase: "wa", card: ms >= t.waIn, pointer: ms >= t.waSend ? "send" : ms >= t.waQuick ? "quick" : ms >= t.waPoint && ms < t.waBox ? "reply" : "none",
      box: ms >= t.waBox && ms < t.waSend, typed: ms >= t.waType && ms < t.waSend ? w.quick : "", ticks: ms >= t.waRead ? "read" : ms >= t.waSent ? "sent" : ms >= t.waSend ? "sending" : "none", mailSent: false };
  }
  const m = DEMO.mail;
  return { phase: "mail", card: true, pointer: ms >= t.mailSend ? "send" : ms >= t.mailQuick ? "quick" : ms >= t.mailPoint && ms < t.mailBox ? "reply" : "none",
    box: ms >= t.mailBox && ms < t.mailSend, typed: ms >= t.mailQuick && ms < t.mailSend ? m.quick : "", ticks: "none", mailSent: ms >= t.mailSent };
}
