// Outsource work to your other computer (PS 1.65): the messages between the PAGE (this web app, which holds the
// vault and does all the crypto) and the MAC app (which runs the jobs and keeps files). Types only, no logic.
// Both sides send one envelope kind: window.webkit...ps.postMessage(JSON) with type "outsource" (page to Mac), and
// the Mac hands the page the object through the usual window.__ps.apply(m) with m.type "outsource" (Mac to page,
// handled in src/outsourcerun.ts; it works the same in the main window and needs no new JS hook). The Mac never sees a key of the vault, never
// signs for the person, and never decides who is paired: the page checks every signature and expiry first and
// only then hands the Mac a plain, already checked job.
export const BRIDGE_VERSION = 1;

/** The two jobs a computer can have. A computer that is neither stays "none" and does nothing. */
export type BridgeRole = "main" | "other" | "none";

/** What the Mac keeps on disk for the page so pairing survives updates and restarts (nothing here ties it to an app version). */
export type KeepRecord = {
  device: string;            // this computer's id (random, made once, never changes)
  name: string;
  role: BridgeRole;
  pub: string;               // public signing key, base64url (ECDSA P-256 raw)
  encPub: string;            // public sealing key, base64url (ECDH P-256 raw)
  priv: string;              // the private halves (the Mac keeps ONLY this field in its Keychain, never in a file or the page's storage)
  peer?: { device: string; name: string; pub: string; encPub: string; pairedAt: number; check?: string };
  phones?: { device: string; name: string; pub: string; encPub: string; pairedAt: number }[];   // the other computer: phones allowed to restart it
  seen?: Record<string, number>;   // the other computer: job and command ids already taken (the replay list), kept across restarts
};

// ---------- page to Mac ----------
export type PageToMac =
  | { type: "outsource"; op: "hello"; v: number }                                         // page is ready, send me "state" and any queued "cli" requests
  | { type: "outsource"; op: "keep"; record: KeepRecord }                                 // save this record (Keychain for priv, file for the rest)
  | { type: "outsource"; op: "forget" }                                                   // unpair here: delete the record
  | { type: "outsource"; op: "status"; status: OtherStatus }                              // the other computer: tell the page what you are (page seals and sends it)
  | { type: "outsource"; op: "run"; job: PlainJob }                                       // a CHECKED job: run it (other computer only)
  | { type: "outsource"; op: "cancel"; id: string }
  | { type: "outsource"; op: "land"; id: string; report: string; bundle?: { name: string; sha256: string; size: number; n: number }; shots?: string[] } // main computer: a verified result arrived, ask for chunks next
  | { type: "outsource"; op: "chunk"; id: string; i: number; b64: string }                // main computer: one verified chunk of a landed bundle
  | { type: "outsource"; op: "restart"; kind: "restart" | "shutdown"; id: string; at: number; from: string } // other computer: a signed, fresh, checked command, run it through the restart helper
  | { type: "outsource"; op: "cli-answer"; req: string; ok: boolean; text: string; id?: string } // answer to a CLI request
  | { type: "outsource"; op: "island"; text: string };                                    // optional: show a line on the island

// ---------- Mac to page (an object given to window.__ps.apply) ----------
export type MacToPage =
  | { type: "outsource"; op: "state"; v: number; keep: KeepRecord | null; app: string; model: string; chip: string; name: string; helper: "approved" | "needs approval" | "not set up" | "missing"; awake: boolean; locked: boolean; cli: string[]; folder: string }
  | { type: "outsource"; op: "progress"; id: string; state: JobRun; step?: string; tail?: string; startedAt?: number; endedAt?: number; exit?: number } // runner (other computer)
  | { type: "outsource"; op: "done"; id: string; state: "done" | "failed" | "cancelled" | "timeout"; report: string; exit?: number; bundle?: { name: string; sha256: string; size: number; n: number }; shots?: string[] }
  | { type: "outsource"; op: "chunk"; id: string; i: number; b64: string }               // runner: one piece of the bundle (CHUNK bytes before base64)
  | { type: "outsource"; op: "landed"; id: string; path: string }                         // main computer: where the bundle now sits
  | { type: "outsource"; op: "cli"; req: string; cmd: CliRequest }                        // the AI on this Mac asked for something through the PS command line
  | { type: "outsource"; op: "power"; awake: boolean; locked: boolean };                  // changed while open

export type JobRun = "queued" | "running" | "done" | "failed" | "cancelled" | "timeout";

/** What a job is once the page has checked it. No secrets, no credentials (core/second.ts looksSecret refuses first). */
export type PlainJob = {
  id: string;
  title: string;
  repo: string;              // a git URL without credentials, or a folder name the other computer already has
  base: string;              // base commit (hash) or branch name to start from
  prompt: string;
  returns: { bundle: boolean; report: boolean; screenshots: boolean };
  minutes: number;           // time limit
  tool: "claude" | "codex";
  createdAt: number;
  expiresAt: number;
};

export type OtherStatus = {
  awake: boolean; locked: boolean; busy: boolean; queue: number;
  app: string; model: string; chip: string; battery?: number; charging?: boolean;
  tools: string[];           // which of "claude", "codex", "git" it found
  helper: "approved" | "needs approval" | "not set up" | "missing";
};

/** What the person's own AI can ask for through the PS command line. */
export type CliRequest =
  | { cmd: "status" }
  | { cmd: "send"; title: string; repo: string; base: string; prompt: string; bundle?: boolean; screenshots?: boolean; minutes?: number; tool?: "claude" | "codex" }
  | { cmd: "list" }
  | { cmd: "result"; id: string }
  | { cmd: "cancel"; id: string };   // no restart here on purpose: an AI never restarts a computer (the phone and the tab do, on a click)

/** Bundle pieces: raw size per chunk before base64. */
export const BRIDGE_CHUNK = 192 * 1024;
