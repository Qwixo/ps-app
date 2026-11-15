// The WhatsApp answer for a whole snapshot: is WhatsApp on for the signed in account? Fails closed (core/waswitch.ts has the rules).
import type { Snapshot } from "./vault";
import { settingsData } from "./select";
import { waOn } from "./waswitch";

export { WA_FEATURE, waSwitch } from "./waswitch";
export const waOnSnap = (s: Snapshot): boolean => waOn(s, settingsData(s) as { squadFeatures?: unknown });
