// The phone's menu, top left (V1.47). The developer, 10 Nov 2026: "The hamburger navbar on the very top left: I like it, but add more
// to it: the screen time, the PS rules (which is for some reason at the very top of the screen, like the copy to clipboard
// stuff), the numerology tab and the timelines. All in the hamburger icon to clear it up. On the Plan tab I just want the
// Meetings menu, and put everything else including Goals and Time zones in the hamburger icon."
// So everything that sat in the phone's top row (screen time, Morning brief, End your day, which opens the PS rules check
// on the developer's account, clear the clipboard, the gear) and every Plan panel but Meetings is an item here. Each item names the
// real button it taps (`sel`, inside the phone's home): those buttons still render where they always did, hidden, so each
// screen opens exactly as before. Pure: no React, no DOM (gos/GosLayer.tsx draws it, tests/gos-menu.test.ts checks it).
import { CAMPAIGNS_ON } from "../core/features.ts";

export type MenuId =
  | "screentime" | "clocks" | "timelines" | "goals" | "series" | "numerology" | "brief"
  | "dimx" | "receipts" | "campaigns" | "gsquad" | "rules" | "endday" | "clipboard" | "edit" | "settings";

export interface MenuItem {
  id: MenuId;
  label: string;
  /** One plain line under the label. */
  line: string;
  /** The heading it sits under. */
  section: "Your day" | "Tools" | "";
  /** An SVG path, 24 by 24, stroked. */
  icon: string;
  /** The real button it taps, inside `.gos-home`. No sel: GosLayer does it itself (Time zones, Goals, G Squad, Settings). */
  sel?: string;
  /** The developer's account only (Numerology, PS Rules, Morning brief, Campaigns: the developer's own, 5 and 7 Nov 2026). */
  red?: true;
  /** Where the old place was, for the report and the tests: every old item stays two taps away or fewer. */
  was: string;
  /** What its live value is, read from the real button as the menu opens: a small value on the right, or the line. */
  live?: "value" | "line";
}

export const MENU: MenuItem[] = [
  { id: "screentime", section: "Your day", label: "Screen time", line: "Today on this phone and your Macs, by app.", sel: ".tm-tr .tm-st-btn", live: "value", was: "top row",
    icon: "M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18.5h2" },
  { id: "clocks", section: "Your day", label: "Time zones", line: "Your clocks, people and the time converter.", was: "Plan",
    icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 12h17M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" },
  { id: "timelines", section: "Your day", label: "Timelines", line: "Countdowns to birthdays, trips and deadlines.", sel: ".tm-left .tm-tl-pill", live: "line", was: "Plan",
    icon: "M7 3h10M7 21h10M8 3c0 5 8 4 8 9s-8 4-8 9M16 3c0 5-8 4-8 9" },
  { id: "goals", section: "Your day", label: "Goals", line: "Your macro, meso and micro goals on one timeline.", was: "Plan, inside Timelines",
    icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z" },
  { id: "series", section: "Your day", label: "Series map", line: "Your series calendar: streaks, journal and goals.", sel: ".tm-left [aria-label^='Map:']", was: "Plan",
    icon: "M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14" },
  { id: "numerology", section: "Your day", label: "Numerology", line: "Today's number and your people's numbers.", sel: ".tm-left .nu-pill", red: true, live: "value", was: "Plan",
    icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01" },
  { id: "brief", section: "Your day", label: "Morning brief", line: "Your day in one page: calls, emails and what is due.", sel: ".tm-tr [aria-label='Morning brief']", red: true, was: "top row",
    icon: "M5 4h11a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0 3 0V9h-3M5 4a2 2 0 0 0-2 2v12a2.5 2.5 0 0 0 2.5 2.5H19.5M7 8.5h7M7 12h7M7 15.5h4" },
  { id: "dimx", section: "Tools", label: "Dimension X", line: "What you are aware of, outside the list.", sel: ".tm-xrow .dx-dock button", was: "Plan",
    icon: "M6 6l12 12M18 6L6 18" },
  { id: "receipts", section: "Tools", label: "Purchases", line: "Scan a receipt and see what you spend.", sel: ".tm-right .rc-btn", was: "new in V1.65 (the Tab list's Purchases button)",
    icon: "M6 3h12v18l-2.5-1.6L13 21l-2-1.6L9 21l-2.5-1.6L6 21zM9 8h6M9 12h6M9 16h3" },
  { id: "campaigns", section: "Tools", label: "Campaigns", line: "Cold email stats from Instantly.", sel: ".tm-xrow .cs-btn", red: true, was: "Plan",
    icon: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM4 7.5l8 5.5 8-5.5" },
  { id: "gsquad", section: "Tools", label: "G Squad", line: "Your squad, the board and the chat.", was: "Settings, G Squad",
    icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4.5-6.5" },
  { id: "rules", section: "Tools", label: "PS Rules", line: "Your rule book: read and edit your rules.", red: true, was: "Plan and the dock (the dock keeps it)",
    icon: "" },
  { id: "endday", section: "Tools", label: "End your day", line: "The PS rules check, then the list resets.", sel: ".tm-tr [aria-label^='End your day']", was: "top row",
    icon: "M2.5 18h19M6.5 18a5.5 5.5 0 0 1 11 0M8 21.5h8M3.9 13.3l1.7 1M20.1 13.3l-1.7 1M12 2.5v6M9.4 6.3L12 8.9l2.6-2.6" },
  { id: "clipboard", section: "Tools", label: "Clear the clipboard", line: "Empties what you copied, so nothing pastes by mistake.", sel: ".tm-tr [aria-label='Clear the clipboard']", was: "top row",
    icon: "M9 3h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" },
  // V1.56 the phone's own Edit mode (gos/PhoneEditMode.tsx): its hidden button is drawn inside the phone's home.
  { id: "edit", section: "Tools", label: "Edit layout", line: "Move, add and remove panels, pages and the navbar.", sel: ".pm-edit-open", was: "new in V1.56 (holding the navbar opens it too)",
    icon: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" },
  { id: "settings", section: "", label: "Settings", line: "Search, or pick a group. Same as the PS app button.", was: "top row gear and the dock (the dock keeps it)",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.8 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.1 14H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.8H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" },
];

/** End your day says what it does for this account: the developer's opens his PS rules check first. */
export const ENDDAY_LINE_FRIEND = "Files away what you ticked and starts a fresh day.";

/** The menu for this person, in order: the developer only items left out for anyone else, and an item whose real button is not
 *  on the page (a feature switched off, like screen time) left out too. */
export function menuItems({ red, has }: { red: boolean; has: (sel: string) => boolean }): MenuItem[] {
  return MENU.filter((m) => (!m.red || red) && (!m.sel || has(m.sel)) && (m.id !== "campaigns" || CAMPAIGNS_ON))   // Campaigns: core/features.ts
    .map((m) => (m.id === "endday" && !red ? { ...m, line: ENDDAY_LINE_FRIEND } : m));
}
