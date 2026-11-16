// Run: node --experimental-strip-types tests/featreq.test.ts
// Feature requests from the Settings assistant (core/featreq.ts, squad/featreqhub.ts): only the person's words and the part of Settings,
// sealed with the squad key, change only, Undo. A fake hub and fictional members; nothing real is called.
import { FR_MAX, SQUAD_LIST_MAX, UNDO_MS, mergeSquadList, squadListText, retryable, afterSend, buildRequest, canUndo, cleanEntries, cleanRequest, due, frAad, hold, requestKeys, scrub, undo } from "../src/core/featreq.ts";
import { deleteRequest, pullRequests, sealRequest, sendRequest } from "../src/squad/featreqhub.ts";
import { readFileSync } from "node:fs";
import { seal } from "../src/core/squadcrypto.ts";
import { V, newSignPair, newSquadKey, open } from "../src/core/squadcrypto.ts";
import { HubError } from "../src/squad/hub.ts";
import type { SquadRec } from "../src/core/squadrec.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const ID = "123e4567-e89b-12d3-a456-426614174000";
const NOW = new Date("2026-11-17T10:00:00Z");

// ---- what is in a request
const r = buildRequest("Let me pick my own pop-up colour", "posture", NOW, ID)!;
ok("exactly five keys: version, id, text, part, time", requestKeys(r).join() === "at,id,part,text,v");
ok("the text and the part, nothing else", r.text === "Let me pick my own pop-up colour" && r.part === "posture" && r.v === 1);
ok("no part when it is not a real group", buildRequest("hello there", "../vault", NOW, ID)!.part === null && buildRequest("hello there", undefined, NOW, ID)!.part === null);
ok("no words, no request", buildRequest("", "posture", NOW, ID) === null && buildRequest("  a ", "posture", NOW, ID) === null && buildRequest(5, "posture", NOW, ID) === null);
ok("an email, a link and a key never leave", (() => { const t = scrub("mail me at sam@example.com or https://example.com/x?token=abc and FAKEKEYABCDEFGHIJKLMNOPQRSTUVWXYZ0123"); return !/@|https|ABCDEFGHIJ/.test(t) && t.includes("[removed]") && t.includes("[link]"); })());
ok("text is cut to the limit and has no dashes", scrub("a — b ".repeat(300)).length <= FR_MAX && !/[–—]/.test(scrub("a — b")));
ok("nothing from the vault: extra fields are never carried", (() => { const c = cleanRequest({ ...r, name: "Sam Example", todos: ["x"], vault: "secret", email: "sam@example.com" }); return !!c && requestKeys(c).join() === "at,id,part,text,v"; })());
ok("a bad id or version is no request", cleanRequest({ ...r, id: "x" }) === null && cleanRequest({ ...r, v: 2 }) === null && cleanRequest(null) === null);

// ---- sealed with the squad key
const rec = { v: 1, squadId: "223e4567-e89b-12d3-a456-426614174000", memberId: "323e4567-e89b-12d3-a456-426614174000", me: "Me", keys: [{ gen: 1, k: await newSquadKey() }], sign: await newSignPair(), box: await newSignPair(), secret: "s", joinedAt: NOW.toISOString() } as SquadRec;
const sealed = await sealRequest(rec, r);
ok("sealed: the hub sees an id, a key generation and scrambled text", Object.keys(sealed).sort().join() === "ct,gen,id" && !sealed.ct.includes("pop-up") && sealed.gen === 1);
ok("sealed: the squad key opens it, with its own aad", JSON.stringify(await open(rec.keys[0].k, sealed.ct, frAad(V, rec.squadId, rec.memberId, r.id))) === JSON.stringify(r));
ok("sealed: another request id cannot open it (aad)", await open(rec.keys[0].k, sealed.ct, frAad(V, rec.squadId, rec.memberId, "423e4567-e89b-12d3-a456-426614174999")).then(() => false, () => true));
let sentBody = "";
const hubOk = async (_u: string, i: RequestInit) => { sentBody = String(i.body); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
const hub404 = async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 });
const hub500 = async () => new Response("{}", { status: 500 });
ok("sent: the body holds no plain words and no name", await sendRequest(rec, r, hubOk) === "sent" && !sentBody.includes("pop-up") && !sentBody.includes("posture") && !sentBody.includes(rec.me));
ok("a hub without the feature yet answers missing, not an error", await sendRequest(rec, r, hub404) === "missing" && await deleteRequest(rec, r.id, hub404) === "missing");
ok("a real hub error is an error", await sendRequest(rec, r, hub500).then(() => false, (e) => e instanceof HubError && e.status === 500));

// ---- Undo and the state
const h = hold(r, 1000);
ok("held for a few seconds", h.state === "held" && h.sendAt === 1000 + UNDO_MS && UNDO_MS >= 3000 && UNDO_MS <= 10_000);
ok("not due before, due after", !due(h, 1000 + UNDO_MS - 1) && due(h, 1000 + UNDO_MS));
ok("Undo works while held and after it was sent", canUndo(h) && undo(h).state === "undone" && undo(afterSend(h, "sent")).state === "undone");
ok("Undo does nothing once taken back, waiting or kept", !canUndo(undo(h)) && !canUndo(afterSend(h, "missing")) && !canUndo(afterSend(h, "nosquad")));
ok("an undone request is never due", !due(undo(h), 1e12));
ok("after sending: sent, waiting (hub part not there) or kept (no squad)", afterSend(h, "sent").state === "sent" && afterSend(h, "missing").state === "waiting" && afterSend(h, "nosquad").state === "kept");
ok("a restart never sends a held request by itself", cleanEntries(JSON.parse(JSON.stringify([h]))).every((e) => e.state === "kept"));
ok("saved entries are cleaned", cleanEntries("x").length === 0 && cleanEntries([{ req: { ...r, id: "bad" }, state: "sent" }, { req: r, state: "weird" }, { req: r, state: "sent", sendAt: 5 }]).length === 1);

// ---- the squad's list (PS 1.65 review): opened with the squad key, change only, nothing but the words and the part
const OTHER = "523e4567-e89b-12d3-a456-426614174000";
const r2 = buildRequest("A darker island please", "island", new Date("2026-11-17T11:00:00Z"), "623e4567-e89b-12d3-a456-426614174000")!;
const mineRow = { id: r.id, member_id: rec.memberId, ...(await sealRequest(rec, r)), deleted: false };
const otherRow = { id: r2.id, member_id: OTHER, gen: 1, ct: await seal(rec.keys[0].k, r2, frAad(V, rec.squadId, OTHER, r2.id)), deleted: false };
const movedRow = { id: "723e4567-e89b-12d3-a456-426614174000", member_id: OTHER, gen: 1, ct: await seal(rec.keys[0].k, { ...r2, id: "723e4567-e89b-12d3-a456-426614174000" }, frAad(V, rec.squadId, rec.memberId, "723e4567-e89b-12d3-a456-426614174000")), deleted: false };
const oldKeyRow = { ...otherRow, id: "823e4567-e89b-12d3-a456-426614174000", gen: 9 };
let pulled = "";
const hubPull = (rows: unknown[]) => async (_u: string, i: RequestInit) => { pulled = String(i.body); return new Response(JSON.stringify({ now: "2026-11-17T12:00:00Z", rows }), { status: 200 }); };
const p1 = await pullRequests(rec, [], null, hubPull([mineRow, otherRow, movedRow, oldKeyRow]));
ok("pull: the squad's requests open, newest first, yours marked", p1 !== "missing" && p1.list.map((x) => x.id).join() === `${r2.id},${r.id}` && p1.list[1].mine && !p1.list[0].mine);
ok("pull: a row moved to another author does not open (aad names the author)", p1 !== "missing" && !p1.list.some((x) => x.id === movedRow.id));
ok("pull: a row under a key this device does not hold is skipped", p1 !== "missing" && !p1.list.some((x) => x.id === oldKeyRow.id));
ok("pull: a row holds the words, the part and the time, never a name or member id", p1 !== "missing" && p1.list.every((x) => Object.keys(x).sort().join() === "at,id,mine,part,text") && !JSON.stringify(p1.list).includes(OTHER));
ok("pull: the next one asks only for what changed since", p1 !== "missing" && p1.since === "2026-11-17T12:00:00Z" && JSON.parse(pulled).args.since === null);
const p2 = await pullRequests(rec, p1 === "missing" ? [] : p1.list, p1 === "missing" ? null : p1.since, hubPull([{ id: r2.id, member_id: OTHER, ct: "", gen: 1, deleted: true }]));
ok("pull: a request taken back leaves the list", p2 !== "missing" && p2.list.length === 1 && p2.list[0].id === r.id && JSON.parse(pulled).args.since === "2026-11-17T12:00:00Z");
ok("pull: a hub without the feature yet is missing (the list stays hidden)", await pullRequests(rec, [], null, hub404) === "missing");
ok("pull: junk from the hub never crashes", (await pullRequests(rec, [], null, hubPull([null, 5, { id: 3 }, { id: "x", ct: "zz", gen: 1 }])) as { list: unknown[] }).list.length === 0);
ok("merge: capped", mergeSquadList([], Array.from({ length: 300 }, (_, i) => ({ id: `id${i}`, gone: false, mine: false, req: { ...r, id: `id${i}`, at: new Date(1e12 + i).toISOString() } }))).length === SQUAD_LIST_MAX);
ok("copy text: one line each, part and words, no member", squadListText(p1 === "missing" ? [] : p1.list, (g) => g.toUpperCase()) === `2026-11-17 | ISLAND | A darker island please\n2026-11-17 | POSTURE | Let me pick my own pop-up colour`);
ok("waiting and kept requests go out with the next send, held and sent ones do not", retryable(afterSend(hold(r, 0), "missing")) && retryable(afterSend(hold(r, 0), "nosquad")) && !retryable(hold(r, 0)) && !retryable(afterSend(hold(r, 0), "sent")) && !retryable(undo(hold(r, 0))));

// ---- the hub function and its migration (read as text: the shape every hub function has)
const fn = readFileSync(new URL("../supabase/hub/functions/featreq/index.ts", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/hub/migrations/featreq_001_requests.sql", import.meta.url), "utf8");
ok("hub: signed requests only, with a replay guard and a clock check", fn.includes("verify(me.sign_pub") && fn.includes("featreq_nonces") && fn.includes('"clock"'));
ok("hub: only members who were let in", fn.includes('.eq("admitted", true)') && fn.includes('.is("left_at", null)'));
ok("hub: undo deletes only your own", /case "fr_del"[\s\S]*?\.eq\("member_id", me\.id\)/.test(fn));
ok("hub: a pull is change only and capped", /case "fr_pull"[\s\S]*?gt\("updated_at", since\)[\s\S]*?/.test(fn) && fn.includes(".limit(200)"));
ok("hub: tables locked like the rest (RLS forced, no client access)", sql.includes("force row level security") && sql.includes('"no client access"') && sql.includes("featreq_items_squad"));
ok("hub: the table stores only scrambled text, ids and times", !/\b(text|words|part|name)\s+text\b/.test(sql.replace(/--.*$/gm, "")));

console.log(fails ? `${fails} of ${n} FAILED` : `ok: ${n} checks`);
process.exit(fails ? 1 : 0);
