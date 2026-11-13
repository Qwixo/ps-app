// The words of the "what is new" walkthroughs (core/walkthrough.ts, views/Walkthrough.tsx). Every word here is shown to
// other people, so the developer approves them before a release (~/Projects/ps-handover-notes/v158-tips.md lists them all).
// Plain words, no em or en dashes (tests/walkthrough.test.ts checks). {app} is the person's own app name ("PS app").
//
// Where a 1.58 feature was still being built when these were written, the names below follow the developer's own words and the
// build chats' notes at that time. Change a word here only; nothing else holds walkthrough words.
import type { WalkStepId } from "./walkthrough.ts";

export interface WalkWords { title: string; lines: string[] }

export const WALK_WORDS: Record<WalkStepId, WalkWords> = {
  // 1. The island's grey bar has a right click menu (island-move-158).
  "158-menu": {
    title: "Right click the island's grey bar",
    lines: [
      "The thin grey bar on top of the Dynamic Island now has its own menu: Settings, Disappear for this meeting, and Disappear for 30 minutes (scroll or type to change the time).",
      "Disappear for this meeting shows during a meeting and brings the island back when it ends. To bring it back early, click Show it now in Settings, Dynamic Island.",
    ],
  },
  // 2. The island's settings in a wide window, and the same settings in a new Settings tab (island-move-158).
  "158-settings": {
    title: "The island's settings, bigger and neater",
    lines: [
      "Pick Settings in that menu and the island's settings open in a wide window: Look, Position, Full screen and Notifications.",
      "The same settings are also in Settings, in the new Dynamic Island tab.",
    ],
  },
  // 3. Into the top bar and right into the corner, and the full screen setting (island-move-158).
  "158-topbar": {
    title: "Put the island anywhere, even in the top bar",
    lines: [
      "Drag the grey bar to move the island right into a corner, or up into the black bar at the top of your screen, beside the notch.",
      "With In full screen, sit in the top bar on, it moves into that bar by itself whenever an app is full screen.",
    ],
  },
  // 4. Pomodoro (pomodoro-158).
  "158-pomodoro": {
    title: "New: a Pomodoro timer",
    lines: [
      "Click Pomodoro in your Tab list to work in focused sessions with short breaks in between.",
      "During a break the island counts down for you. Change the times in Settings, Pomodoro timer.",
    ],
  },
  // 5. Stand-up reminders (pomodoro-158).
  "158-standup": {
    title: "New: Stand-up reminders",
    lines: [
      "Every 30 minutes {app} reminds you to stand up for 2 minutes. In the last 15 seconds a small tab on the island's right side counts you down, then the island shows a little man standing.",
      "Change how often and how long, try one now, or turn them off in Settings, Stand-up reminders.",
    ],
  },
  // 6. The next meeting bubble on the island (pomodoro-158).
  "158-meeting": {
    title: "Your next meeting, on the island",
    lines: [
      "A small bubble on the island's right side counts down to your next meeting, like Team call in 12m.",
      "In the last 2 minutes it turns into Join when the meeting has a link, and during the meeting it shows the time left.",
    ],
  },
  // 7. AI messages on the island (ai-message-158).
  "158-ai": {
    title: "New: messages from your AI on the island",
    lines: [
      "Claude Code, Codex and other AIs on your Mac can now send you a short message on the island when they finish.",
      "In Settings, AI task API, find Connect your AI: switch on Send you messages, then click Copy for your AI and paste it into your AI.",
    ],
  },
  // 8. Friends only, never on the developer's account (protected-158).
  "158-protected": {
    title: "Now works over 1Password and Signal",
    lines: [
      "Hold Tab while 1Password or Signal is in front and your list opens over it. The island stays on screen there too.",
      "{app} never reads or touches either app.",
    ],
  },
};

/** The grey bar's right click menu, drawn in the first step's picture (the same words as the real menu, island-move-158). */
export const WALK_MENU_ITEMS = ["Settings", "Disappear for this meeting", "Disappear for 30 minutes"] as const;

/** The buttons and the small step count. */
export const WALK_BUTTONS = {
  next: "Next",
  done: "Done",
  show: "Show me",
  skip: "Skip",
  /** "2 of 6" */
  count: "{n} of {total}",
} as const;
