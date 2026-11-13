// Notification cards: a colour and a sound per kind (core/notelook.ts, V1.36).
import assert from "node:assert/strict";
import { NOTE_COLORS, NOTE_KINDS, NOTE_NOW, NOTE_SOUNDS, cardTones, cleanNoteLook, noteLookMsg, notePref, notePrefs, noteSampleName, noteSoundName, noteSoundTones, pickChime, withNotePref } from "../src/core/notelook.ts";
import { contrast } from "../src/core/looks.ts";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("unset is exactly today: chats and leads chime Glass, emails and other alerts quiet, meetings by kind", () => {
  const p = notePrefs({});
  assert.deepEqual(p.done, { color: null, on: true, sound: "glass" });
  assert.deepEqual(p.mail, { color: null, on: false, sound: "glass" });
  assert.deepEqual(p.lead, { color: null, on: true, sound: "glass" });
  assert.deepEqual(p.meet, { color: null, on: true, sound: "kind" });
  assert.deepEqual(p.other, { color: null, on: false, sound: "glass" });
  assert.equal(noteSoundName(p.done), "chime");            // the same sound PS played before
  assert.equal(noteSoundName(p.lead), "chime");
  assert.equal(noteSoundName(p.mail), null);
  assert.equal(noteSoundName(p.meet, "meet-alert"), "meet-alert");
  assert.equal(noteSoundName(p.meet, "meet-booked"), "meet-booked");
});
ok("unset sends no colours and no Other alerts sound to the Mac (its cards look as before)", () => {
  const m = noteLookMsg(undefined);
  for (const k of NOTE_KINDS) assert.equal(m[k.id], null, k.id);
  assert.equal(m.otherSound, null);
});
ok("sound off plays nothing, whatever sound is picked", () => {
  for (const k of NOTE_KINDS) {
    const p = notePref({ noteLook: { [k.id]: { on: false, sound: "harp" } } }, k.id);
    assert.equal(noteSoundName(p, "meet-booked"), null, k.id);
  }
  assert.equal(pickChime([{ at: "2026-11-05T10:00:00Z", name: null }, { at: "2026-11-05T10:01:00Z", name: null }]), null);
  assert.equal(noteLookMsg({ noteLook: { other: { on: false, sound: "ding" } } }).otherSound, null);
});
ok("a picked sound plays by its PS name; meetings can pick one for every meeting card", () => {
  assert.equal(noteSoundName(notePref({ noteLook: { done: { sound: "harp" } } }, "done")), "note-harp");
  assert.equal(noteSoundName(notePref({ noteLook: { mail: { on: true } } }, "mail")), "chime");
  assert.equal(noteSoundName(notePref({ noteLook: { meet: { sound: "ding" } } }, "meet"), "meet-alert"), "note-ding");
  assert.equal(noteLookMsg({ noteLook: { other: { on: true, sound: "drop" } } }).otherSound, "note-drop");
});
ok("several new cards at once: one sound, the newest card's", () => {
  assert.equal(pickChime([{ at: "2026-11-05T10:00:00Z", name: "chime" }, { at: "2026-11-05T10:05:00Z", name: "note-harp" }, { at: "2026-11-05T10:02:00Z", name: null }]), "note-harp");
});
ok("cleaned on read: odd values fall back to the default", () => {
  const p = notePref({ noteLook: { done: { color: "url(x)", on: "yes", sound: "kind" } } as never }, "done");
  assert.deepEqual(p, { color: null, on: true, sound: "glass" });   // "By kind" is for meetings only
  assert.equal(notePref({ noteLook: { lead: { color: "#ABC" } } }, "lead").color, "#aabbcc");
});
ok("cleaned on save: only the five kinds and their three fields", () => {
  assert.deepEqual(cleanNoteLook({ noteLook: { done: { color: "#22C55E", on: false, sound: "bell", x: 1 }, evil: { color: "#000000" }, mail: { color: "red;}body{" } } }),
    { noteLook: { done: { color: "#22c55e", on: false, sound: "bell" } } });
  assert.deepEqual(cleanNoteLook({ noteLook: { meet: { sound: "kind" }, other: { sound: "kind", color: null } } }), { noteLook: { meet: { sound: "kind" }, other: { color: null } } });
  assert.deepEqual(cleanNoteLook({ noteLook: null }), { noteLook: null });
  assert.deepEqual(cleanNoteLook({ noteLook: [1] }), {});
  assert.deepEqual(cleanNoteLook({}), {});
});
ok("one change keeps the other kinds; today's own colour or Back to how it was saves nothing", () => {
  const st = { noteLook: { lead: { color: "#22c55e", on: true, sound: "glass" as const } } };
  assert.deepEqual(withNotePref(st, "done", { on: false }), { lead: { color: "#22c55e", on: true, sound: "glass" }, done: { color: null, on: false, sound: "glass" } });
  assert.deepEqual(withNotePref({}, "done", { color: "#d97757" }), {});
  assert.deepEqual(withNotePref(st, "lead", { color: null, on: true, sound: "glass" }), {});
  assert.deepEqual(withNotePref({}, "meet", { color: "#34d399" }), { meet: { color: "#34d399", on: true, sound: "kind" } });   // by kind: a pick is a pick
});
ok("every colour makes a readable card (WCAG AA): presets and odd picks", () => {
  const picks = [...NOTE_COLORS.map((c) => c.id), "#000000", "#ffffff", "#ffff00", "#777777", "#123456", "#ff0000", "#00ff00", "#0000ff", "#f0f", "#fde68a"];
  for (const h of picks) {
    const t = cardTones(h);
    for (const [k, v] of Object.entries(t)) assert.match(v, /^#[0-9A-F]{6}$/, `${h} ${k}`);
    assert.ok(contrast("#FFFFFF", t.top) >= 7, `${h}: title on top ${contrast("#FFFFFF", t.top).toFixed(2)}`);
    assert.ok(contrast("#FFFFFF", t.bot) >= 7, `${h}: title on bottom`);
    assert.ok(contrast(t.sub, t.top) >= 4.5 && contrast(t.sub, t.bot) >= 4.5, `${h}: sub line`);
    assert.ok(contrast(t.ic, t.icBg) >= 4.5, `${h}: icon`);
    assert.ok(contrast("#FFFFFF", t.rem) >= 4.5 && contrast("#FFFFFF", t.remHi) >= 4.5, `${h}: Remind me in`);
    assert.ok(contrast(t.ink, t.btn) >= 4.5, `${h}: main button`);
  }
});
ok("the card keeps the pick's hue: coral stays warm, blue stays blue", () => {
  const coral = cardTones("#d97757"), blue = cardTones("#60a5fa");
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, , b1] = rgb(coral.top), [r2, , b2] = rgb(blue.top);
  assert.ok(r1 > b1 && b2 > r2);
  assert.equal(coral.c, "#D97757");
});
ok("the preview's today colours are today's Mac card colours", () => {
  assert.equal(NOTE_NOW.done.top, "#5C2816"); assert.equal(NOTE_NOW.done.sub, "#F2B49B");
  assert.equal(NOTE_NOW.lead.top, "#1D3A8A"); assert.equal(NOTE_NOW.mail.top, "#6E163C");
});
ok("sounds: the first is Glass (today's chime), the old meeting sounds keep their names, the new ones are note-", () => {
  assert.equal(NOTE_SOUNDS[0].native, "chime");
  const natives = NOTE_SOUNDS.map((s) => s.native);
  assert.equal(new Set(natives).size, natives.length);
  for (const x of ["meet-booked", "meet-soon", "meet-alert"]) assert.ok(natives.includes(x), x);
  for (const s of NOTE_SOUNDS) {
    assert.ok(s.native === "chime" || s.native.startsWith("meet-") || s.native.startsWith("note-"), s.native);
    assert.ok(s.tones.length > 0 && s.tones.every((t) => t.dur > 0 && t.dur <= 1.2 && t.peak > 0 && t.peak <= 0.35), s.id);
  }
  assert.equal(noteSampleName("kind"), "meet-booked");
  assert.ok(noteSoundTones("twinkle").length > 0);
});
console.log(`${n} of ${n} ok`);
