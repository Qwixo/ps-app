// Run: node --experimental-strip-types tests/alarmsound.test.ts
// V1.44 alarm sound (src/core/alarmsound.ts): the loudness maths, the built in sounds brought to one level, your own
// sound's file checks and making it ready (one channel, trimmed, the same level, WAV), the alarm loudness, and source
// checks that the page, the Mac and the phone all take part. Nothing is played: every sound here is numbers.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const A = await import("../src/core/alarmsound.ts");
const W = await import("../src/core/sleepwake.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const sine = (f: number, amp: number, secs: number, rate = 8000) => Float32Array.from({ length: Math.round(secs * rate) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / rate));
const near = (a: number, b: number, tol: number, what = "") => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} vs ${b}`);

ok("measuring: peak, the loudest 400 ms, dB", () => {
  const s = sine(440, 0.5, 2);
  near(A.peakOf(s), 0.5, 1e-3);
  near(A.loudestOf(s, 8000), 0.5 / Math.SQRT2, 2e-3, "a sine's RMS");
  near(A.toDb(1), 0, 1e-9); near(A.toDb(0.5), -6.02, 0.01); near(A.fromDb(-12), 0.2512, 1e-4);
  assert.equal(A.loudestOf(new Float32Array(0), 8000), 0);
  // A short loud burst in a long quiet file: the loudest window finds it (a whole file average would not).
  const x = new Float32Array(8000 * 10); x.set(sine(440, 0.8, 0.4), 8000 * 6);
  near(A.loudestOf(x, 8000), 0.8 / Math.SQRT2, 0.03, "burst");
  // A sound shorter than the window is measured whole.
  near(A.loudestOf(sine(440, 0.5, 0.1), 8000), 0.5 / Math.SQRT2, 5e-3, "short");
});

ok("the soft limiter never goes past 1 and leaves quiet samples alone", () => {
  assert.equal(A.soften(0.5), 0.5); assert.equal(A.soften(-0.8), -0.8);
  for (const v of [0.81, 1, 2, 10, 1e6]) { assert.ok(A.soften(v) <= 1 && A.soften(v) > 0.8, String(v)); assert.ok(v > 2 || A.soften(v) < 1); assert.equal(A.soften(-v), -A.soften(v)); }
  assert.ok(A.soften(1.2) > A.soften(1.1));   // still rising: louder in stays louder out
});

ok("normalise: a quiet sound comes up to the one level, a loud one down, silence stays silence", () => {
  for (const amp of [0.02, 0.1, 0.3, 0.9]) {
    const y = A.normalise(sine(440, amp, 1), 8000);
    near(A.toDb(A.loudestOf(y, 8000)), A.TARGET_DB, 0.3, `amp ${amp}`);
    assert.ok(A.peakOf(y) < 1, `peak ${amp}`);
  }
  const z = A.normalise(new Float32Array(800), 8000);
  assert.equal(A.peakOf(z), 0);
  // A near silent file is raised by at most MAX_GAIN_DB (no loud hiss).
  const hiss = sine(440, 1e-4, 1);
  near(A.toDb(A.loudestOf(A.normalise(hiss, 8000), 8000)) - A.toDb(A.loudestOf(hiss, 8000)), A.MAX_GAIN_DB, 0.05, "gain cap");
  // The input is left alone.
  const x = sine(440, 0.1, 0.5); const before = x[100]; A.normalise(x, 8000); assert.equal(x[100], before);
});

ok("the built in sounds are equally loud now (and how much each changed)", () => {
  const out: string[] = [];
  const levels: number[] = [];
  for (const k of ["soft", "alarm"] as const) {
    const t = A.TONES[k];
    const raw = A.renderTones(t.tones, t.loop), y = A.builtInSound(k);
    const before = A.toDb(A.loudestOf(raw, A.RATE)), after = A.toDb(A.loudestOf(y, A.RATE));
    levels.push(after);
    assert.ok(A.peakOf(y) < 1, `${k} never clips`);
    near(after, A.TARGET_DB, 0.3, k);
    assert.equal(y.length, Math.round(t.loop * A.RATE));
    out.push(`${k} ${before.toFixed(1)} dB -> ${after.toFixed(1)} dB (+${(after - before).toFixed(1)} dB)`);
  }
  near(levels[0], levels[1], 0.3, "soft vs alarm");
  // V1.43 measured: the soft chime -18.7 dB and the alarm -19.6 dB, before the rise's 12 to 35% start.
  near(A.toDb(A.loudestOf(A.renderTones(A.TONES.soft.tones, A.TONES.soft.loop), A.RATE)), -18.7, 0.2, "V1.43 chime");
  near(A.toDb(A.loudestOf(A.renderTones(A.TONES.alarm.tones, A.TONES.alarm.loop), A.RATE)), -19.6, 0.2, "V1.43 alarm");
  console.log("   ", out.join("; "));
  // What a V1.43 Soft chime Preview played (chime at its 15% start, at a third) next to Loud, and what plays now.
  const was = -18.7 + A.toDb(0.15 * 0.35), loud = -19.6;
  console.log(`    V1.43 Soft chime preview ${was.toFixed(1)} dB vs Loud ${loud} dB; V1.44 every Test ${A.TARGET_DB} dB`);
});

ok("the tone recipe matches the Mac's (Sfx.wav): 4 ms attack, 60 dB fade, square and sine", () => {
  const sq = A.renderTones([{ f: 100, dur: 1, peak: 1, wave: 2, at: 0 }], 1, 8000);
  near(Math.abs(sq[40]), Math.exp(-6.9 * (0.005 - 0.004) / 0.996), 0.01, "square after the attack");
  near(sq[8], 8 / 8000 / 0.004, 1e-6, "rising in the attack");
  const tail = A.renderTones([{ f: 440, dur: 1, peak: 1, wave: 0, at: 0 }], 1.2, 8000);
  assert.ok(A.peakOf(tail.subarray(8000)) === 0);   // silent after its length
});

ok("your own sound: only real sound files, under the size cap", () => {
  const b = (s: string, extra: number[] = []) => Uint8Array.from([...Array.from(s, (c) => c.charCodeAt(0)), ...extra, ...new Array(16).fill(0)]);
  assert.equal(A.sniffAudio(b("RIFF\0\0\0\0WAVE")), "wav");
  assert.equal(A.sniffAudio(b("FORM\0\0\0\0AIFF")), "aiff");
  assert.equal(A.sniffAudio(b("FORM\0\0\0\0AIFC")), "aiff");
  assert.equal(A.sniffAudio(b("\0\0\0\x20ftypM4A ")), "m4a");
  assert.equal(A.sniffAudio(b("ID3\x04")), "mp3");
  assert.equal(A.sniffAudio(Uint8Array.from([0xff, 0xfb, 0x90, 0x64, ...new Array(12).fill(0)])), "mp3");
  assert.equal(A.sniffAudio(b("%PDF-1.7")), null);
  assert.equal(A.sniffAudio(b("MZ")), null);
  assert.equal(A.sniffAudio(new Uint8Array(4)), null);
  const wav = b("RIFF\0\0\0\0WAVE");
  assert.deepEqual(A.checkOwnFile("YOU ARE BROKE.mp3", 120_000, b("ID3\x04")), { ok: true });
  assert.deepEqual(A.checkOwnFile("alarm.WAV", 2_000_000, wav), { ok: true });
  assert.equal(A.checkOwnFile("song.flac", 1000, wav).ok, false);
  assert.equal(A.checkOwnFile("song.mp3", 0, wav).ok, false);
  assert.equal(A.checkOwnFile("song.mp3", A.OWN_MAX_MB * 1024 * 1024 + 1, b("ID3")).ok, false);
  assert.equal(A.checkOwnFile("evil.mp3", 1000, b("%PDF-1.7")).ok, false);   // the name alone never passes
  for (const e of ["mp3", "m4a", "wav", "aiff"]) assert.ok(A.OWN_ACCEPT.includes(`.${e}`));
  const r = A.checkOwnFile("x.ogg", 10, wav); if (!r.ok) assert.equal(/[\u2013\u2014]/.test(r.why), false);
});

ok("your own sound: name, one channel, the first minute, trimmed, the same level, WAV and back", () => {
  assert.equal(A.ownName("YOU_ARE_BROKE.mp3"), "YOU ARE BROKE");
  assert.equal(A.ownName(".mp3"), "Your sound");
  assert.equal(A.ownName("a".repeat(80) + ".wav").length, 40);
  const rate = 8000;
  const L = sine(300, 0.05, 2, rate), R = sine(300, 0.05, 2, rate);
  const m = A.toMono([L, R], rate); near(m[123], L[123], 1e-6, "mono");
  assert.equal(A.toMono([sine(300, 0.1, 90, rate)], rate).length, A.OWN_MAX_SECS * rate);   // cut to the first minute
  // 1 second of nothing, the sound, 1 second of nothing: trimmed, so it rings at once.
  const padded = new Float32Array(rate * 4); padded.set(sine(300, 0.05, 2, rate), rate);
  const s = A.ownSound([padded], rate)!;
  assert.ok(s); near(s.secs, 2, 0.05, "secs");
  const back = A.wavSamples(s.wav)!;
  assert.equal(back.rate, rate);
  near(A.toDb(A.loudestOf(back.x, rate)), A.TARGET_DB, 0.3, "own sound level");
  assert.ok(Math.abs(back.x[0]) > 0.01 || Math.abs(back.x[1]) > 0.001 || Math.abs(back.x[2]) > 0.001, "starts with the sound");
  assert.equal(A.ownSound([new Float32Array(rate * 3)], rate), null);   // silent: nothing to keep
  // WAV header: 16 bit mono at the rate, the size right.
  const w = A.wavBytes([0, 0.5, -0.5, 1, -1], 32000);
  assert.equal(w.length, 44 + 10);
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), "RIFF");
  const dv = new DataView(w.buffer);
  assert.equal(dv.getUint32(24, true), 32000); assert.equal(dv.getUint16(22, true), 1); assert.equal(dv.getInt16(44 + 6, true), 32767);
  assert.equal(A.wavSamples(Uint8Array.from([1, 2, 3])), null);
  assert.deepEqual(A.cleanOwn({ name: "YOU ARE BROKE", secs: 3.2 }), { name: "YOU ARE BROKE", secs: 3.2 });
  assert.equal(A.cleanOwn({ name: " " }), null); assert.equal(A.cleanOwn(null), null);
  assert.equal(A.cleanOwn({ name: "x", secs: 999 })!.secs, A.OWN_MAX_SECS);
  // A minute at OWN_RATE fits: under 4 MB.
  assert.ok(44 + A.OWN_MAX_SECS * A.OWN_RATE * 2 < 4 * 1024 * 1024);
});

ok("alarm loudness: 10% to 100% in 5% steps, Loud always 100%, a plain line per device", () => {
  assert.equal(A.okLevel(undefined), A.LEVEL_DEF); assert.equal(A.okLevel("x"), A.LEVEL_DEF); assert.equal(A.okLevel(""), A.LEVEL_DEF);
  assert.equal(A.okLevel(0), A.LEVEL_MIN); assert.equal(A.okLevel(7), 1); assert.equal(A.okLevel(0.62), 0.6); assert.equal(A.okLevel(0.63), 0.65);
  assert.equal(A.pct(0.8), "80%");
  assert.equal(A.ringLevel(true, 0.3), 1); assert.equal(A.ringLevel(false, 0.3), 0.3);
  for (const w of ["mac", "phone", "web"] as const) { assert.equal(/[\u2013\u2014]/.test(A.levelLine(w)), false); assert.ok(A.levelLine(w).length > 40); }
  assert.match(A.levelLine("mac"), /puts your volume back/);
  assert.match(A.levelLine("web"), /cannot change your volume/);
  // What really comes out at the start and at full, at the default level (the sample level times the volume).
  for (const s of W.WAKE_STYLES) {
    const spec = W.WAKE_SPEC[s];
    if (spec.sound === "none") continue;
    const top = A.ringLevel(spec.loud, A.LEVEL_DEF);
    assert.ok(W.ringVolume(s, 0) * top >= 0.4, `${s} starts audibly`);
    assert.equal(W.ringVolume(s, 30_000) * top, top, `${s} full in 30 s`);
  }
});

ok("every device takes part: page, Mac, phone; no dashes in the new code", () => {
  const page = src("src/sleepmode/sound.ts"), view = src("src/views/SleepWake.tsx");
  for (const t of ["sleep:sound:get", "sleep:sound:pick", "sleep:sound:save", "sleep:sound:remove", "sleep:test", "sleep:testStop"]) assert.ok(page.includes(`"${t}"`), t);
  assert.match(page, /indexedDB\.open/);
  assert.equal(/vault|supabase|fetch\(/i.test(page.replace(/\/\/[^\n]*/g, "")), false, "the own sound never leaves the device");
  assert.match(view, /TestEsc/); assert.match(view, /e\.key === "Escape"/); assert.match(view, />Stop</);
  for (const f of ["src/core/alarmsound.ts", "src/sleepmode/sound.ts", "src/views/SleepWake.tsx", "tests/alarmsound.test.ts"]) assert.equal(/[\u2013\u2014]/.test(src(f)), false, f);
  const mac = process.env.PS_MAC_DIR || `${process.env.HOME}/Projects/ps-mac`;
  if (existsSync(`${mac}/Sources/SleepSound.swift`)) {
    const s = readFileSync(`${mac}/Sources/SleepSound.swift`, "utf8");
    assert.match(s, /targetDb = -12/); assert.match(s, /maxGainDb = 30/); assert.match(s, /knee = 0\.8/);
    assert.match(s, /ownMaxSecs = 60/);
  }
  const gos = process.env.PS_GOS_DIR || `${process.env.HOME}/Projects/ps-gos`;
  const b = `${gos}/app/src/main/java/com/cincee/ps/gos/Bridge.kt`;
  if (existsSync(b) && readFileSync(`${gos}/app/src/main/java/com/cincee/ps/gos/Sleep.kt`, "utf8").includes("sleep-sound.wav"))
    for (const t of ["sleep:sound:get", "sleep:sound:save", "sleep:sound:remove", "sleep:test", "sleep:testStop"]) {
      assert.ok(readFileSync(`${gos}/app/src/main/java/com/cincee/ps/gos/WebHost.kt`, "utf8").includes(`"${t}" ->`), t);
      // Test runs on the main thread (the player); the file work never does.
      assert.equal(readFileSync(b, "utf8").includes(`"${t}"`), t === "sleep:test" || t === "sleep:testStop", `thread ${t}`);
    }
});

{
  const mac = process.env.PS_MAC_DIR || `${process.env.HOME}/Projects/ps-mac`, gos = process.env.PS_GOS_DIR || `${process.env.HOME}/Projects/ps-gos`;
  const sw = `${mac}/Sources/SleepWake.swift`, kt = `${gos}/app/src/main/java/com/cincee/ps/gos/SleepClock.kt`;
  if (existsSync(sw) && existsSync(kt) && readFileSync(sw, "utf8").includes("V1.44")) ok("the Mac and the phone rise the same way as the page (start, time to full)", () => {
    const s = readFileSync(sw, "utf8"), k = readFileSync(kt, "utf8");
    const num = (v: string) => Number(v.replace(/_/g, ""));
    for (const st of W.WAKE_STYLES) {
      const spec = W.WAKE_SPEC[st];
      if (st === "chime" || st === "wave") {   // the default branch on both
        const m = s.match(/default: return Spec\(sound: "soft", start: ([\d.]+), rise: ([\d_]+)/)!, q = k.match(/else -> Spec\("soft", ([\d.]+), ([\d_]+)/)!;
        assert.equal(num(m[1]), spec.start, `mac ${st}`); assert.equal(num(m[2]), spec.rise, `mac ${st}`);
        assert.equal(num(q[1]), spec.start, `phone ${st}`); assert.equal(num(q[2]), spec.rise, `phone ${st}`);
        continue;
      }
      const key = st === "strobe" ? "white" : st;
      const m = s.match(new RegExp(`case "${key}"[^:\\n]*: return Spec\\(sound: "\\w+", start: ([\\d.]+), rise: ([\\d_]+)`))!;
      const q = k.match(new RegExp(`"${key}"(, "strobe")? -> Spec\\("\\w+", ([\\d.]+), ([\\d_]+)`))!;
      assert.ok(m && q, st);
      assert.equal(num(m[1]), spec.start, `mac ${st}`); assert.equal(num(m[2]), spec.rise, `mac ${st}`);
      assert.equal(num(q[2]), spec.start, `phone ${st}`); assert.equal(num(q[3]), spec.rise, `phone ${st}`);
    }
    assert.match(k, /LEVEL_DEF = 0\.8/); assert.match(readFileSync(`${mac}/Sources/SleepSound.swift`, "utf8"), /levelDef = 0\.8/);
    assert.equal(A.LEVEL_DEF, 0.8);
  });
}
console.log(`\n${n} passed`);
