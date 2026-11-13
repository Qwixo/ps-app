// Emulator tests only (scripts/build-web.sh --fake): the same fictional data as the dev page, so no
// real client, task or email is ever on a test screen. Never in a release build (release.sh checks).
// One fictional task has no priority yet, to show how such a task looks (no P number, at the bottom).
// Two fictional Claude chats have just finished, to show their notifications (core/chatdone.ts).
import { __devLoad } from "../core/vault";
import { fakeDocs } from "../dev/fake";
import type { Doc, Settings, Todo } from "../core/model";

export const GOS_FAKE_MARKER = "gos-fictional-test-data";
export function loadFake() {
  const docs = fakeDocs();
  const open = docs.filter((d): d is Doc<Todo> => d.kind === "todo" && (d.data as Todo).type === "once" && !(d.data as Todo).done && !(d.data as Todo).p1);
  const last = open.sort((a, b) => (b.data.order ?? 0) - (a.data.order ?? 0))[0];
  if (last) last.data = { ...last.data, unranked: true };
  const st = docs.find((d): d is Doc<Settings> => d.kind === "settings");
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  if (st) st.data = { ...st.data, chatDone: [
    { id: "fake-chat-1", chat: "Fictional chat: rebuild the pricing page", at: ago(1) },
    { id: "fake-chat-2", chat: "Fictional chat: draft the Lumi follow up", at: ago(4) },
  ] };
  // ?work=<style>: the first open task is the one being worked on, in that Working on look (pictures only)
  const w = typeof location !== "undefined" ? new URLSearchParams(location.search).get("work") : null;
  if (w && st && open.length) st.data = { ...st.data, workingIds: [open[open.length - 1].id], tmWorkStyle: w };
  __devLoad(docs);
}
