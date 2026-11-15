// FICTIONAL G Squad for the dev server's Tab list only (never in a release build): made up people, tasks, chat,
// boards and gym data, handed to the Tab list the way PS's main page would (the plain views, no keys), so the
// G Squad window can be drawn and pictured with no hub. Load with /client/overlay?fake&gsquad (src/App.tsx);
// V1.49 (one squad, everyone in): &gsquad=joining (or none) shows Getting you in, &gsquad=left (Join again),
// &gsquad=removed, &gsquad=full, &gsquad=error; &gsquad=solo is the developer alone in The G Squad.
// &open (or the phone's page) opens the G Squad screen straight away; &gstab=settings or another section picks it.
import { setSquadMirror } from "../squad/mirror";
import { setChatMirror } from "../squad/chatmirror";
import { setGymMirror } from "../squad/gymview";
import { gymStore } from "../squad/gym";
import { loadGymFake } from "./gym-fake";

const ME = "00000000-0000-4000-8000-000000000001";
const SAM = "00000000-0000-4000-8000-0000000000a1", KIT = "00000000-0000-4000-8000-0000000000a2", ANA = "00000000-0000-4000-8000-0000000000a3";
const ago = (min: number) => new Date(Date.now() - min * 60e3).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function loadGSquadFake() {
  const mode = new URLSearchParams(location.search).get("gsquad") || "in";
  const members = [
    { id: ME, name: "Alex", me: true, creator: true, working: true },
    { id: SAM, name: "Sam Rivera", me: false, creator: false, working: true },
    { id: KIT, name: "Kit", me: false, creator: false, working: false },
    { id: ANA, name: "Ana Petrova", me: false, creator: false, working: true },
  ];
  const tasks = [
    { id: "t1", member: ME, t: "Finish the onboarding copy", p: 1, d: null, x: false },
    { id: "t2", member: ME, t: "Send the weekly numbers", p: 2, d: null, x: true },
    { id: "t3", member: SAM, t: "Fix the checkout bug", p: 1, d: null, x: false },
    { id: "t4", member: SAM, t: "Gym at 18:00", p: null, d: null, x: false, e: true },
    { id: "t5", member: ANA, t: "Client call prep", p: 2, d: null, x: false, a: true },
    { id: "t6", member: ANA, t: "Draft the new landing page", p: 3, d: null, x: true },
  ];
  const entry = (member: string, rank: number, n: number) => ({ member, state: "ok" as const, rank, n });
  const board = {
    rules: { money: "revenue", show: "rank", currency: "GBP" },
    money: { "1": [entry(SAM, 1, 0), entry(ME, 2, 0), { member: ANA, state: "off", rank: null }, { member: KIT, state: "none", rank: null }], "3": [], "6": [] },
    tasks: { "7d": [entry(ANA, 1, 31), entry(ME, 2, 24), entry(SAM, 3, 19), entry(KIT, 4, 6)], month: [entry(ANA, 1, 92), entry(ME, 2, 88), entry(SAM, 3, 61), entry(KIT, 4, 20)], "3m": [] },
    screen: [ME, SAM, KIT, ANA].map((m, i) => ({ member: m, state: i === 2 ? "off" : "ok", today: [14200, 9800, null, 17100][i], mac: [11000, 8000, null, 12000][i], phone: [3200, 1800, null, 5100][i], avg: [15000, 10400, null, 16000][i],
      week: [12000, 15000, 13800, 16000, 9000, 14100, 14200].map((x) => (i === 2 ? null : x + i * 900)), at: ago(3) })),
    days: Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10)),
    mine: { tz: "Asia/Dubai", on: true, months: [] }, ask: null, loaded: true,
  };
  const asks: never[] = [];   // V1.49: nobody asks to join any more (everyone is in by themselves)
  const notIn = (stage: string, error: string | null = null) => ({ in: false, loaded: true, auto: { stage, error } });
  const squad = mode === "none" || mode === "joining"
    ? notIn("joining")
    : mode === "left"
      ? notIn("left")
    : mode === "removed"
      ? notIn("removed", "The admin took you out of The G Squad.")
    : mode === "full"
      ? notIn("full", "The G Squad is full (200 people).")
    : mode === "error"
      ? notIn("error", "G Squad could not be reached. Check your internet and try again.")
    : mode === "solo"
      ? { in: true, name: "The G Squad", me: ME, meName: "Alex", creator: true, count: 1, waiting: 0, members: [members[0]], tasks: [], hands: [], link: null, busy: null, error: null, loaded: true, board, asks: [] }
      : { in: true, name: "The G Squad", me: ME, meName: "Alex", creator: true, count: 3, waiting: 1, members, tasks,
        hands: [{ id: id(700), from: SAM, to: ME, state: "open", t: "Review the pricing page", d: null, at: ago(30) }], link: null, busy: null, error: null, loaded: true, board, asks };

  const day = (d: number, h: number, m: number) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const lines = [
    { id: id(1), from: SAM, name: "Sam Rivera", mine: false, t: "Morning all. Who is in for a focus block at 10?", at: day(1, 9, 2), edited: false, left: false },
    { id: id(2), from: ANA, name: "Ana Petrova", mine: false, t: "Me, after my client call", at: day(1, 9, 5), edited: false, left: false },
    { id: id(3), from: ME, name: "Alex", mine: true, t: "In. Starting the onboarding copy", at: day(1, 9, 6), edited: false, left: false },
    { id: id(4), from: KIT, name: "Kit", mine: false, t: "I'll join at 11, gym first", at: day(1, 9, 20), edited: false, left: false },
    { id: id(5), from: SAM, name: "Sam Rivera", mine: false, t: "New bench best today", at: day(0, 8, 41), edited: false, left: false, a: { k: "gym", l: "Barbell bench press, 72.5 kg x 4" } },
    { id: id(6), from: SAM, name: "Sam Rivera", mine: false, t: "Felt strong. Two more weeks of this block", at: day(0, 8, 42), edited: false, left: false },
    { id: id(7), from: ME, name: "Alex", mine: true, t: "That is a big jump, nice one", at: day(0, 8, 50), edited: false, left: false },
    { id: id(8), from: ME, name: "Alex", mine: true, t: "Handing you the pricing page review, it is in your Tasks", at: day(0, 8, 51), edited: true, left: false },
    { id: id(9), from: ANA, name: "Ana Petrova", mine: false, t: "Done with the landing page draft. 92 tasks this month, catch me if you can", at: day(0, 9, 14), edited: false, left: false },
  ];
  const chat = { in: !["none", "joining", "left", "removed", "full", "error"].includes(mode), ready: true, open: true, unread: 2, lines, more: false, votes: [], note: null, sound: false, notify: true, notifyOn: true, noteSound: true, sending: 0, error: null, loaded: true };

  setTimeout(() => {
    setSquadMirror(squad);
    setChatMirror(chat);
    const q = new URLSearchParams(location.search);
    // &note: the website's G Squad message card (views/SquadNoteCards.tsx, PS 1.60) with a made up message (dev page /client/dev?fake&note).
    if (q.has("note")) void Promise.all([import("../squad/chatengine"), import("../core/squadnotify")]).then(([e, n]) => {
      e.devShowNote(n.noteCard({ id: id(50), from: SAM, name: "Sam Rivera", t: "Landing page is live. Can you check the pricing section before 3?", at: new Date().toISOString() }));
    });
    if (q.has("open") || (globalThis as { __psMobile?: unknown }).__psMobile === true) void import("../views/GSquad").then((g) => g.openGSquad(true, q.get("gstab") || undefined));
    if (mode === "in" || mode === "asks") {
      loadGymFake();
      const push = () => setGymMirror(gymStore.get());
      gymStore.subscribe(push);
      push();
    }
  }, 700);
}
