// Example tasks, the PS page that holds the keys (G Squad): a brand new account gets them once, after its first sync
// (core/examples.ts says who counts as new). The Tab list asks for "Delete all example tasks" and its Undo through a
// "looks" message (ps.ts), and they run here (core/actions.ts deleteExamples, undoExamples).
import { vaultStore } from "./core/vault";
import { settingsData, todos } from "./core/select";
import { shouldSeed } from "./core/examples";
import { accountOlderThan } from "./core/whatsnew";
import { seedExamples } from "./core/actions";

const BUILT = typeof __PS_WHATSNEW__ === "object" ? __PS_WHATSNEW__.built : "";

export function startExamples(ps: boolean) {
  let decided = false;
  const check = () => {
    if (decided) return;
    const s = vaultStore.get();
    if (s.status !== "unlocked" || !s.lastSync || s.syncing) return;
    decided = true;
    const st = settingsData(s);
    const older = accountOlderThan(BUILT, [...s.docs.values()].map((d) => d.updatedAt));
    if (shouldSeed({ ps, owner: s.role === "owner", red: s.red, synced: true, todoCount: todos(s).length, examples: st.examples, accountOlder: older })) void seedExamples();
  };
  vaultStore.subscribe(check);
  check();
}
