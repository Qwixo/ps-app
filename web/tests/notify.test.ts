// Run: node --experimental-strip-types tests/notify.test.ts
// "Claude updated your vault" (src/core/notify.ts describeOps): a finished chat and housekeeping never
// count, real changes from Claude still do. FICTIONAL clients and chats.
import assert from "node:assert/strict";
const N = await import("../src/core/notify.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const chatDone = { op: "chatDone", id: "s1", chat: "Fictional chat", at: "2026-10-30T12:00:00.000Z" };

ok("a finished chat alone says nothing (it has its own card)", () => {
  assert.deepEqual(N.describeOps([chatDone]), []);
});
ok("several finished chats together still say nothing, never \"N settings\"", () => {
  assert.deepEqual(N.describeOps([chatDone, { ...chatDone, id: "s2" }, { ...chatDone, id: "s3" }]), []);
});
ok("trimming old Instantly previews is housekeeping, not a change", () => {
  assert.deepEqual(N.describeOps([{ op: "pruneInstantly" }]), []);
});
ok("quietOp names exactly the bookkeeping steps", () => {
  assert.equal(N.quietOp("chatDone"), true);
  assert.equal(N.quietOp("pruneInstantly"), true);
  for (const op of ["putBrief", "addTodo", "claudeTick", "upsertProject", "updateSettings", "meetingNotes"]) assert.equal(N.quietOp(op), false, op);
});
ok("a real change next to a finished chat is told without the chat", () => {
  assert.deepEqual(N.describeOps([chatDone, { op: "putBrief" }]), ["your Morning Brief"]);
});
ok("dashboards, to-dos and the Morning Brief still notify", () => {
  assert.deepEqual(N.describeOps([
    { op: "upsertProject", name: "Fictional Studio" }, { op: "addTodo" }, { op: "claudeTick" }, { op: "putBrief" }, chatDone,
  ]), ["Fictional Studio's dashboard", "your Morning Brief", "2 to-do items"]);
});
ok("a real setting (not a chat) still counts as a setting", () => {
  assert.deepEqual(N.describeOps([{ op: "meetingNotes" }]), ["1 setting"]);
});

console.log(`\n${n} notify checks passed`);
