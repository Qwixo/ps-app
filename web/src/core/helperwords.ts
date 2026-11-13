// What the Security window and the Auto reboot card say about the restart helper when it is not running (V1.45).
// ps-mac Sources/AutoReboot.swift tells the page `offBy`: "update" when the helper ran here in an older build and
// macOS now wants the yes again (it ties its yes to the helper's exact build, as PS has no Apple team), "settings"
// when it ran in this very build and someone switched PS off in System Settings. No offBy while it waits for the
// first yes after Set up. The words are plain and never just "waiting": they say what happened and what to click.
export type HelperState = "on" | "approve" | "off" | "missing" | "test";
export type OffBy = "update" | "settings";

export interface HelperWords {
  /** The short pill next to the title. */
  pill: string;
  /** The one paragraph that says what happened and what to do. */
  banner: string;
  /** The button that opens System Settings, General, Login Items and Extensions. */
  button: string;
  /** The line under this Mac's timer in the Security window. */
  clock: string;
  /** The "Restart helper" row in the Security window. */
  row: string;
  /** The "Auto reboot" row in the Security window. */
  autoRow: string;
}

const WHERE = "System Settings, General, Login Items and Extensions";

/** The words for a helper that is not running, or null when it runs (or this build has none). */
export function helperWords(helper: HelperState, offBy: OffBy | undefined, app: string, listHint = ""): HelperWords | null {
  if (helper !== "approve") return null;
  if (offBy === "update") return {
    pill: "Switched off by macOS",
    banner: `macOS switched off the restart helper after the update. Find ${app}${listHint} under Allow in the Background (${WHERE}) and switch it on. If it already looks on, switch it off and then on again. Auto reboot then carries on with your settings by itself.`,
    button: "Open System Settings",
    clock: "Not running: macOS switched off the restart helper after the update",
    row: "Switched off by macOS after the update",
    autoRow: `Off until you switch ${app} on again`,
  };
  if (offBy === "settings") return {
    pill: "Switched off in System Settings",
    banner: `The restart helper is switched off in System Settings. Find ${app}${listHint} under Allow in the Background (${WHERE}) and switch it on to use auto reboot again. If it already looks on, switch it off and then on again.`,
    button: "Open System Settings",
    clock: "Not running: the restart helper is switched off in System Settings",
    row: "Switched off in System Settings",
    autoRow: `Off until you switch ${app} on again`,
  };
  return {
    pill: "Needs your OK in System Settings",
    banner: `Open ${WHERE}, find ${app}${listHint} under Allow in the Background and switch it on. If it already looks on, switch it off and then on again.`,
    button: "Open it again",
    clock: `Not running: switch ${app} on in Login Items (off and then on again if it looks on)`,
    row: "Needs your OK",
    autoRow: "Waits for your OK first",
  };
}
