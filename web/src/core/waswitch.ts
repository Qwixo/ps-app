// The pure part of the WhatsApp switch (no vault, no DOM, so it is unit tested). On only when ALL are true: the vault is unlocked, the
// account is the primary owner of the project it is signed in to (the sealed messages can only be opened by that owner, same rule
// as client emails, core/mailswitch.ts), the person switched "WhatsApp" on (the feature "whatsapp" in features.json, default off),
// and WhatsApp messages is not switched off in WhatsApp settings. Off for everyone until they link it: without a link no message
// ever arrives. Any doubt means off.
import { mailCan, type MailWho } from "./mailswitch.ts";
import { cleanSwitches, registry } from "./features.ts";
import type { WaPrefs } from "./whatsapp.ts";

export const WA_FEATURE = "whatsapp";
/** The person's own switch for the feature, read against this build's registry. Not in the registry: off. */
export function waSwitch(squadFeatures: unknown): boolean {
  if (!registry().some((x) => x.id === WA_FEATURE)) return false;
  return cleanSwitches(squadFeatures)[WA_FEATURE] === true;
}
export function waOn(s: MailWho, st: { squadFeatures?: unknown; wa?: WaPrefs } | null | undefined): boolean {
  return mailCan(s) && waSwitch(st?.squadFeatures) && st?.wa?.on !== false;
}
