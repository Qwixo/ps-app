// The words of the three "new in this version" pop-ups (V1.56). Every word a person reads in them is HERE and only
// here, so the developer can approve and edit the exact text in one place. Plain, short, no em or en dashes.
// {app} is the person's own name for the app ("PS app" unless they renamed it).
//
// The one line risk note of the Auto approve pop-up is Settings' own line (APPROVE_LINE in core/autoapprove.ts), shown
// word for word, so Settings and the pop-up can never disagree. The AI prompt the open source pop-up copies is
// core/opensource.ts, and the text the API pop-up copies is the same one Settings, AI task API, Copy for AI copies
// (core/taskapidoc.ts): neither is repeated here.

export interface PopupWords {
  title: string;
  /** Two or three short plain lines. */
  lines: string[];
  /** The one main button. */
  main: string;
  /** The second button (opens something), when there is one. */
  second?: string;
  /** Closes it for good. */
  later: string;
}

export const POPUP_WORDS: { api: PopupWords; approve: PopupWords; source: PopupWords } = {
  api: {
    title: "New: your AI can manage your tasks",
    lines: [
      "Your AI, like Claude Code or Codex, can now add and manage your tasks in {app}.",
      "Tasks it adds land in your AI Inbox, so you decide where they go.",
    ],
    main: "Turn on and copy for AI",
    second: "Open settings",
    later: "Not now",
  },
  approve: {
    title: "Also new: {app} can now approve your AI permission prompts for you",
    lines: [
      "Turn on Auto approve and {app} says Yes when your AI asks for permission, so long jobs keep going. Questions still wait for you.",
      "Pick when it works: in AI mode, in Sleep mode, or always.",
    ],
    main: "See how",
    later: "Not now",
  },
  source: {
    title: "{app} is open source",
    lines: [
      "All of {app}'s code is public, so anyone can read exactly what it does.",
      "For extra trust, ask your own AI to check it. Copy the prompt, then paste it into your AI.",
    ],
    main: "Copy for your AI",
    second: "Open",
    later: "Not now",
  },
};

/** The little label above the risk line in the Auto approve pop-up. */
export const APPROVE_RISK_LABEL = "Worth knowing";

/** What the pop-ups say while they work and when they are done. */
export const POPUP_STATUS = {
  /** The API pop-up, while the API switches on. */
  working: "Turning on...",
  /** Shown after a copy worked. */
  copiedTitle: "Copied",
  copiedApi: "Paste it into your AI and ask it to add a task.",
  copiedSource: "Paste it into your AI with the code folder open.",
  /** The one button after Copied. */
  done: "Got it",
  /** The API could not switch on or give its key. */
  apiFailed: "Could not turn it on. Open settings to try again.",
  /** The clipboard did not accept the text. */
  copyFailed: "Could not copy. Open the link and copy the prompt from the repo.",
} as const;
