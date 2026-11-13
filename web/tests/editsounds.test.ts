// Run: node --experimental-strip-types tests/editsounds.test.ts
// V1.56 Edit overview sounds (core/editsounds.ts, src/ui/sfx.ts editSfx, ps-mac Sources/Sfx.swift): short, soft, our
// own tones, played only when allowed, and PS's copy has the same names and numbers.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { EDIT_SOUNDS, EDIT_SOUND_MAX, EDIT_SOUND_NAMES, TICK_GAP_MS, editSoundOk, editSoundsOn, meetingNow, passTick, soundLength, type EditTone } from "../src/core/editsounds.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

ok("ten sounds, every one under 0.4 s and soft (quiet enough for all day)", () => {
  assert.deepEqual(EDIT_SOUND_NAMES, ["edit-in", "edit-out", "edit-fly", "edit-tick", "edit-drop", "edit-page-add", "edit-page-remove", "edit-save", "edit-switch", "edit-reset"]);
  for (const name of EDIT_SOUND_NAMES) {
    assert.ok(soundLength(name) <= EDIT_SOUND_MAX, `${name} ${soundLength(name)}`);
    for (const t of EDIT_SOUNDS[name] as EditTone[]) {
      assert.ok(t.peak > 0 && t.peak <= 0.16, `${name} peak ${t.peak}`);
      assert.ok(t.f >= 100 && t.f <= 4000 && (t.to === undefined || (t.to >= 100 && t.to <= 4000)), name);
      assert.ok([0, 1, 2, 3].includes(t.wave));
    }
  }
  // Each sound's tones together stay soft too.
  for (const name of EDIT_SOUND_NAMES) assert.ok((EDIT_SOUNDS[name] as EditTone[]).reduce((a, t) => a + t.peak, 0) <= 0.21, name);
  // The tick while sliding is the quietest and shortest.
  assert.ok(soundLength("edit-tick") < 0.03);
});

ok("they play only when allowed: switch on, volume up and not muted, Do Not Disturb, no meeting on", () => {
  const g = { on: true, volume: 0.4, dndMutesSounds: false, meetingNow: false };
  assert.equal(editSoundOk(g), true);
  assert.equal(editSoundOk({ ...g, on: false }), false);
  assert.equal(editSoundOk({ ...g, volume: 0 }), false, "muted or volume 0");
  assert.equal(editSoundOk({ ...g, dndMutesSounds: true }), false);
  assert.equal(editSoundOk({ ...g, meetingNow: true }), false);
  assert.equal(editSoundsOn({}), true, "on unless switched off");
  assert.equal(editSoundsOn({ editSounds: false }), false);
  assert.equal(editSoundsOn(null), true);
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(meetingNow([{ start: now - 60_000, end: now + 60_000 }], now), true);
  assert.equal(meetingNow([{ start: new Date(now + 60_000), end: new Date(now + 3_600_000) }], now), false, "a meeting later is not now");
  assert.equal(meetingNow([], now), false);
});

ok("sliding: one soft tick per page passing the middle, never a rattle", () => {
  let st = { page: 0, at: -1000 };
  const ticks: number[] = [];
  // The camera slides from page 0 to page 3 in 30 frames of 16 ms.
  for (let f = 0; f <= 30; f++) {
    const r = passTick(st.page, (3 * f) / 30, st.at, f * 16);
    if (r.tick) ticks.push(f);
    st = { page: r.page, at: r.at };
  }
  assert.equal(ticks.length, 3, String(ticks));
  // A very fast flick past many pages: never closer than 70 ms.
  st = { page: 0, at: -1000 };
  const at: number[] = [];
  for (let f = 0; f <= 10; f++) { const r = passTick(st.page, f, st.at, f * 16); if (r.tick) at.push(f * 16); st = { page: r.page, at: r.at }; }
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= TICK_GAP_MS);
});

ok("the page asks for them by name (PS plays its own copy), honouring the switch, mute, Do Not Disturb and meetings", () => {
  const sfx = src("ui/sfx.ts");
  assert.match(sfx, /if \(!editSoundOk\(\{ \.\.\.editCtx, on: editCtx\.on \|\| preview, volume \}\)\) return;\n  if \(viaApp\(name\)\) return;/);
  const tm = src("views/TaskMap.tsx");
  assert.match(tm, /setEditSoundCtx\(\{ on: editSoundsOn\(st\), dndMutesSounds: dndMutes\(st\.dnd, "sounds", Date\.now\(\), PS \? "mac" : "web"\), meetingNow: meetingNow\(meet\) \}\);/);
  // Where they play.
  const em = src("views/EditMode.tsx");
  for (const name of EDIT_SOUND_NAMES) assert.match(em, new RegExp(`editSfx\\("${name}"`), name);
  // One switch with the other sound settings.
  assert.match(src("core/settingsindex.ts"), /\{ id: "edit-sounds", group: "list", name: "Edit mode sounds"/);
  assert.match(src("views/SettingsGroups.tsx"), /"edit-sounds": row\(\(\) => <EditSoundsSwitch \/>\)/);
});

ok("PS's own copy (ps-mac Sources/Sfx.swift) has the same names and numbers, once merged", () => {
  const dir = process.env.PS_MAC ?? `${homedir()}/Projects/ps-mac`;
  const f = `${dir}/Sources/Sfx.swift`;
  if (!existsSync(f) || !readFileSync(f, "utf8").includes('"edit-in"')) { console.log("  (skipped: this ps-mac has no Edit sounds yet; PS_MAC=<ps-mac worktree> checks a branch)"); return; }
  const sw = readFileSync(f, "utf8");
  for (const name of EDIT_SOUND_NAMES) {
    const want = (EDIT_SOUNDS[name] as EditTone[]).map((t) => `Tone(f: ${t.f}, to: ${t.to ?? "nil"}, dur: ${t.dur}, peak: ${t.peak}, wave: ${t.wave}, at: ${t.at})`).join(", ");
    assert.ok(sw.includes(`"${name}": [${want}]`), name);
  }
  assert.match(sw, /if t\.wave == 3 \{/);
});

ok("no em or en dashes", () => { assert.doesNotMatch(src("core/editsounds.ts"), /[–—]/); });

console.log(`\n${n} passed`);
