// Keeps feature() (core/features.ts) knowing who is signed in and their own "From the squad" switches, and hands every
// feature's answer to the Mac (V1.58, multiple developers). The Mac stores the answers (ps-mac Features.swift) so
// Features.on("id") agrees with the page, also on the next launch before the vault is open.
// Message to the Mac: {type: "features", on: {"<feature id>": true | false, ...}}, sent only when the answers change
// and only once someone is signed in (before that the Mac keeps what it was last told).
import { vaultStore, type Snapshot } from "./core/vault";
import { settingsData } from "./core/select";
import { accountKind } from "./core/account";
import { cleanSwitches, featureAnswers, registry, setFeatureContext, whoFor, type Account } from "./core/features";
import { profile } from "./core/profile";

// The person's own switches live with the other settings in the vault (saved per account, so they follow the person).
declare module "./core/model" {
  interface Settings {
    /** Settings, "From the squad" (V1.58): this person's On/Off per feature made by someone else (core/features.ts). Missing: the build's default. */
    squadFeatures?: Record<string, boolean>;
  }
}

/** The developer's own account, anyone else's, or nobody signed in yet. */
export function accountOf(s: Pick<Snapshot, "status" | "role" | "red">): Account {
  const k = accountKind(s);
  return k === null ? null : k === "red" ? "red" : "other";
}

let started = false;
export function startFeatureSync(post?: (m: object) => void): void {
  if (started) return;
  started = true;
  let last = "";
  const run = () => {
    const s = vaultStore.get();
    const account = accountOf(s);
    const mine = cleanSwitches(settingsData(s).squadFeatures);
    setFeatureContext(account, mine);
    if (!post || account === null) return;
    const on = featureAnswers(registry(), whoFor(profile(), account), mine);
    const key = JSON.stringify(on);
    if (key === last) return;
    last = key;
    post({ type: "features", on });
  };
  vaultStore.subscribe(run);
  run();
}
