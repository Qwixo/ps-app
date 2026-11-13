// Tab keeps the list open (the developer, 7 Nov 2026): hold Tab and let go and the Tab list stays open; the next hold
// of Tab puts it away (a quick tap is still a normal Tab). PS for Mac decides and keeps it, per Mac, like
// the other Tab settings (ps-mac TabWatch.stays, UserDefaults "tabStays"). Never chosen: on for everyone
// else (the public build, nobody signed in), off for the developer. These mirror that rule for the Mac settings switch,
// which shows what PS says and falls back to the same default before PS has answered.

/** The default while nobody has chosen: off for the developer's account, on for anyone else. */
export const tabStaysDefault = (red: boolean): boolean => !red;

/** What the switch shows: PS's own answer, else the default for this account. */
export function tabStaysShown(st: { tabStays?: boolean } | null | undefined, red: boolean): boolean {
  return typeof st?.tabStays === "boolean" ? st.tabStays : tabStaysDefault(red);
}

/** The one line under the switch. */
export const TAB_STAYS_HINT = "On: hold Tab and let go, and the list stays open until you hold Tab again. A quick press is still a normal Tab, and Esc closes it.";
