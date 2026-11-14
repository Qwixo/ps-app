// The per person "Client emails" switch (PS 1.60). It replaces the old developer only check for everything to do with
// client emails and Instantly replies: cards, the email panel, Reply from PS, the email notifications.
//
// Client emails are ON only when ALL of these are true, and any doubt means OFF (fails closed):
//   1. the vault is unlocked and the account is an owner (never a client member of someone's workspace);
//   2. the account is the primary owner of the Supabase project it is signed in to (`primary`, set from the
//      database's own vault_role(); nobody's account counts as the developer's, this is a separate fact);
//   3. the person switched "Client emails" on. That switch is the feature "client-emails" in features.json, so it is the same
//      switch as Settings, From the squad: stored per person in settings.squadFeatures, default off.
// Why the primary owner: the mail functions seal every email to the one app_owner of the project they run on, so only
// that account can ever open them. Someone else's emails can never reach your vault.
import type { Snapshot } from "./vault.ts";
import { cleanSwitches, registry, whoFor } from "./features.ts";
import { profile } from "./profile.ts";

export const MAIL_FEATURE = "client-emails";
export type MailWho = Pick<Snapshot, "status" | "role"> & { primary?: boolean };

/** Can this account use client emails at all (is the switch offered)? */
export function mailCan(s: MailWho): boolean {
  return s.status === "unlocked" && s.role === "owner" && s.primary === true;
}
/** Is the Client emails feature on for this account? Pure: the person's switch is passed in (true only when switched on). */
export function mailOn(s: MailWho, switchedOn: unknown): boolean {
  return mailCan(s) && switchedOn === true;
}
/** The person's own switch, read from their settings against this build's registry. The person's answer wins, then the
 *  profile's own override, else off. It does not matter whose build this is (a person's own build included), so the
 *  Settings switch always works. Not in the registry: off (fails closed). */
export function mailSwitch(squadFeatures: unknown): boolean {
  if (!registry().some((x) => x.id === MAIL_FEATURE)) return false;
  const mine = cleanSwitches(squadFeatures)[MAIL_FEATURE];
  if (typeof mine === "boolean") return mine;
  return whoFor(profile(), "other").overrides[MAIL_FEATURE] === true;
}
