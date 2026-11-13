// Plain words for the setup screens (G Squad, the developer 7 Nov 2026: "explain everything in simple terms... say this is so
// if your Supabase gets hacked, everything is end to end encrypted so still only you can see the data... spell it
// out for someone who isn't tech savvy. And say why we need a database").
//
// Checked against the real crypto (core/crypto.ts, core/vault.ts) so every sentence is TRUE:
// - The key is the PS passphrase. passphrase + username --PBKDF2 600k--> master --HKDF--> the key that locks the
//   random vault key, and separately the login password Supabase stores (it never sees the passphrase itself).
//   Records are AES-256-GCM encrypted on the device before they are sent.
// - The Supabase database password is NOT the key: PS makes a random one when it creates the project
//   (ps-mac ProjectEngine.databasePassword()) and nobody ever types or needs it. The password of the person's
//   Supabase account (supabase.com log in) is not the key either.
// - Nobody can reset the passphrase; the recovery key (shown once) is the only other way in.
// Every word is shown to other people: Rule Zero, the developer approves the exact words (ps-handover-notes/gsquad-welcome-copy.md).
// The installer's copy of these words is in ps-mac ui/supabase.html (SUPABASE_SETUP_COPY below lists them).

export interface PrivacyPoint { title: string; text: string }

export const PRIVACY_TITLE = "How your data stays private";

/** own: the person's own Supabase project (PS's Create account); false: an invite onto someone else's server.
 *  device: "Mac" in PS, "device" on the website. */
export function privacyPoints(o: { own: boolean; device: "Mac" | "device" }): PrivacyPoint[] {
  const d = o.device;
  const out: PrivacyPoint[] = [
    o.own
      ? { title: "Why a database?", text: "Your list is saved in your own Supabase project, a free online database that belongs to you. That is what keeps your Mac and your phone in sync, even when you are away from home." }
      : { title: "Why a database?", text: "Your list is saved in an online database. That is what keeps your Mac and your phone in sync, even when you are away from home." },
    { title: "Your passphrase is the key", text: `The passphrase you choose here locks and unlocks everything. Your list is scrambled (encrypted) on this ${d} before it is sent, and only your passphrase can unscramble it. Your passphrase never leaves this ${d}.` },
    o.own
      ? { title: "Safe even if Supabase is hacked", text: "If someone broke into your Supabase account, all they would find is scrambled data they cannot read. Supabase cannot read it either. Only you can, because only you know your passphrase." }
      : { title: "Safe even if the database is hacked", text: "If someone broke into the database, all they would find is scrambled data they cannot read. The people who run it cannot read it either. Only you can, because only you know your passphrase." },
  ];
  if (o.own) out.push({ title: "Not your Supabase password", text: "The password you use to log in to Supabase is not the key, and you never need a database password: PS makes one for you. Only your passphrase unlocks your data." });
  return out;
}

/** The words added to the installer's Supabase setup (ps-mac ui/supabase.html), for the approval list and the tests. */
export const SUPABASE_SETUP_COPY: readonly string[] = [
  "Why do I need this, and is it safe?",
  "Why a database? PS saves your list in a free Supabase project that belongs to you. That is what keeps your Mac and your phone in sync, even when you are away from home.",
  "Is it safe? Yes. PS scrambles (encrypts) everything on this Mac before it is sent. The key is the passphrase you pick when you create your PS account, right after this setup. Your passphrase never leaves this Mac.",
  "Even if someone broke into your Supabase account, all they would find is scrambled data they cannot read. Supabase cannot read it either. Only you can, because only you know your passphrase.",
  "Your Supabase password is not the key, and you never need a database password: PS makes one for you. Only your passphrase unlocks your data.",
  "Next, create your PS account and pick a passphrase. Your passphrase is the key to your data: it never leaves this Mac, and without it nobody, not even Supabase, can read anything.",
];

/** Every sentence of the setup explanations (the approval list and the no-dash test read this). */
export function setupCopy(): string[] {
  const pts = [...privacyPoints({ own: true, device: "Mac" }), ...privacyPoints({ own: false, device: "device" })];
  return [PRIVACY_TITLE, ...pts.flatMap((p) => [p.title, p.text]), ...SUPABASE_SETUP_COPY];
}
