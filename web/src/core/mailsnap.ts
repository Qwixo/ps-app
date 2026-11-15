// The Client emails answer for a whole snapshot (reads the person's settings, so it lives apart from the pure core/mailswitch.ts).
import type { Snapshot } from "./vault";
import { settingsData } from "./select";
import { mailCan, mailSwitch } from "./mailswitch";
import { accountKind } from "./account";

/** Is Client emails on for the signed in account? Primary owner of their own project and switched on, else off. */
export function mailOnSnap(s: Snapshot): boolean {
  return mailCan(s) && mailSwitch((settingsData(s) as { squadFeatures?: unknown }).squadFeatures, accountKind(s) === "red" ? "red" : "other");
}
