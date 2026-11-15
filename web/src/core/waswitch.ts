// The pure part of the WhatsApp switch (no vault, no DOM, so it is unit tested). On only when ALL are true: the vault is unlocked, the
// account is the primary owner of the project it is signed in to (the sealed messages can only be opened by that owner, same rule
// as client emails, core/mailswitch.ts), "WhatsApp" is on for them (the feature "whatsapp" in features.json, default on
// since V1.62; their own Off wins), and WhatsApp messages is not switched off in WhatsApp settings. Nothing arrives until they link
// their number: without a link no message ever comes in. Any doubt means off.
import { mailCan, type MailWho } from "./mailswitch.ts";
import { switchOn, type Account } from "./features.ts";
import type { WaPrefs } from "./whatsapp.ts";

export const WA_FEATURE = "whatsapp";
/** The person's own switch for the feature, read against this build's registry (core/features.ts switchOn): their answer,
 *  else the build's answer for their account. Not in the registry: off. */
export function waSwitch(squadFeatures: unknown, account: Account = "other"): boolean {
  return switchOn(WA_FEATURE, squadFeatures, account);
}
export function waOn(s: MailWho, st: { squadFeatures?: unknown; wa?: WaPrefs } | null | undefined, account: Account = "other"): boolean {
  return mailCan(s) && waSwitch(st?.squadFeatures, account) && st?.wa?.on !== false;
}
