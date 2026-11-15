// The WhatsApp answer for a whole snapshot: is WhatsApp on for the signed in account? Fails closed (core/waswitch.ts has the rules).
import type { Snapshot } from "./vault";
import { settingsData } from "./select";
import { waOn } from "./waswitch";
import { accountKind } from "./account";

export { WA_FEATURE, waSwitch } from "./waswitch";
/** V1.62: the account decides the default (core/features.ts switchOn), as for Client emails (core/mailsnap.ts). */
export const waAccount = (s: Snapshot): "red" | "other" => (accountKind(s) === "red" ? "red" : "other");
export const waOnSnap = (s: Snapshot): boolean => waOn(s, settingsData(s) as { squadFeatures?: unknown }, waAccount(s));
