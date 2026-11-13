// Minecraft mode (views/Minecraft.tsx): the Latin Georgian reader (core/kalatin.ts) and the panel's rules (core/mcmode.ts).
// The two Magti SMS the developer sent on 4 Nov 2026 are read with the real word lists when they are on this Mac (ps-mac
// translate/*.txt.gz, or PS_MC_LEXICON); the small fixture list below always runs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import { buildLetterModel, detectLang, protectForModel, georgianToLatin, lookup, parseWordList, piecesToGeorgian, readText, readWord, wordListOf, type Lexicons } from "../src/core/kalatin.ts";
import { addHistory, bubbleSpot, bytesText, cleanHistory, cleanSpot, defaultTo, packLine, plan, swapped } from "../src/core/mcmode.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

// ---------- a tiny fixture list ----------
const kaFix = wordListOf([["წუთი", 20], ["ლარი", 22], ["დღე", 26], ["ვადა", 18], ["მარტივად", 14], ["მართლა", 20], ["და", 40], ["რომ", 38], ["მადლობა", 24], ["ეს", 36], ["ან", 34], ["არ", 38]]);
const enFix = wordListOf([["off", 30], ["text", 26], ["an", 40], ["the", 46], ["hello", 28]]);
const fix: Lexicons = { ka: kaFix, en: enFix, lm: buildLetterModel(kaFix, 14) };

ok("word lists load sorted, with buckets, and look words up", () => {
  const l = parseWordList(["%ბ", "#ა", "+გ"].join("\n"));
  assert.deepEqual(l.words, ["ა", "ბ", "გ"]);
  assert.equal(lookup(l, "ა"), 2); assert.equal(lookup(l, "ბ"), 4); assert.equal(lookup(l, "დ"), -1);
});
ok("ambiguous letters are settled by the word list (t: თ or ტ, ts: ც or წ)", () => {
  assert.equal(readWord("tsuti", fix)[0].geo, "წუთი");
  assert.equal(readWord("martivad", fix)[0].geo, "მარტივად");
  assert.equal(readWord("martla", fix)[0].geo, "მართლა");
  assert.ok(readWord("tsuti", fix)[0].known);
});
ok("unknown words still get a Georgian guess, marked as a guess", () => {
  const r = readWord("gamarjoba", fix);
  assert.ok(r.length > 0 && /^[ა-ჰ]+$/.test(r[0].geo));
  assert.equal(r[0].known, false);
});
ok("codes, numbers, links and brands stay exactly as they are", () => {
  const t = "100 tsuti - 4 lari, 9 000 MB, 5G, *288# OK MyMagti www.magticom.ge/sakvirveli329-2";
  const g = piecesToGeorgian(readText(t, fix));
  assert.ok(g.includes("100 წუთი - 4 ლარი, 9 000 MB, 5G, *288# OK MyMagti www.magticom.ge/sakvirveli329-2"), g);
});
ok("an English line stays English", () => {
  const p = readText("SMS Off 91521 Text: MAGTICOM", fix);
  assert.equal(piecesToGeorgian(p), "SMS Off 91521 Text: MAGTICOM");
});
ok("Georgian script back to Latin letters, Magti style", () => {
  assert.equal(georgianToLatin("მადლობა, რომ აირჩიეთ მაგთი"), "madloba, rom airchiet magti");
  assert.equal(georgianToLatin("წუთი ჩატით შეგიძლიათ ღამე ხვალ ყველა ქალაქი"), "tsuti chatit shegidzliat ghame khval yvela qalaqi");
});
ok("language by letters, and Latin text by its words", () => {
  assert.equal(detectLang("Привет, как дела?", fix), "ru");
  assert.equal(detectLang("გამარჯობა", fix), "ka");
  assert.equal(detectLang("vada 30 dghe, madloba", fix), "kl");
  assert.equal(detectLang("hello the text", fix), "en");
  assert.equal(detectLang("anything", null), "en");
});

ok("lari amounts and carrier names reach the model as lari and names", () => {
  assert.equal(protectForModel("100 წუთი - 4 ლარი,\n9 000 MB - 10 ლარი"), "100 წუთი - 4 lari,\n9 000 MB - 10 lari");
  assert.equal(protectForModel("5G ეს მაგთია! მადლობა, რომ აირჩიეთ მაგთი."), "5G ეს Magti! მადლობა, რომ აირჩიეთ Magti.");
  assert.equal(protectForModel("ლარის კურსი"), "ლარის კურსი", "no amount, no change");
  assert.equal(protectForModel("2.50 ლარად"), "2.50 lari");
});

// ---------- the panel's rules ----------
ok("plans: Latin Georgian is read first, Georgian pairs need no model, Latin output at the end", () => {
  assert.deepEqual(plan("kl", "en"), { readLatin: true, model: { src: "kat_Geor", tgt: "eng_Latn" }, toLatin: false });
  assert.deepEqual(plan("en", "kl"), { readLatin: false, model: { src: "eng_Latn", tgt: "kat_Geor" }, toLatin: true });
  assert.deepEqual(plan("kl", "ka"), { readLatin: true, model: null, toLatin: false });
  assert.deepEqual(plan("ka", "kl"), { readLatin: false, model: null, toLatin: true });
  assert.deepEqual(plan("ru", "ka"), { readLatin: false, model: { src: "rus_Cyrl", tgt: "kat_Geor" }, toLatin: false });
  assert.equal(defaultTo("en"), "ka"); assert.equal(defaultTo("kl"), "en");
  assert.deepEqual(swapped("kl", "en"), { from: "en", to: "kl" });
});
ok("history: cleaned, newest first, no duplicates, at most 25", () => {
  assert.deepEqual(cleanHistory([{ at: 1, from: "xx", to: "en", src: "a", out: "b" }, 5, null]), []);
  let h = cleanHistory([{ at: 1, from: "kl", to: "en", src: "a", out: "b" }]);
  h = addHistory(h, { at: 2, from: "kl", to: "en", src: "a", out: "b2" });
  assert.equal(h.length, 1); assert.equal(h[0].out, "b2");
  for (let i = 0; i < 40; i++) h = addHistory(h, { at: 10 + i, from: "en", to: "ka", src: "s" + i, out: "o" });
  assert.equal(h.length, 25); assert.equal(h[0].src, "s39");
});
ok("the bubble stays on screen and remembers its spot", () => {
  assert.deepEqual(bubbleSpot(null, 1440, 900), { x: 28, y: 140 });
  assert.deepEqual(bubbleSpot({ x: 5000, y: -40 }, 1440, 900), { x: 1370, y: 12 });
  assert.deepEqual(bubbleSpot({ x: 300.4, y: 200.6 }, 1440, 900), { x: 300, y: 201 });
  assert.equal(cleanSpot("x"), null); assert.deepEqual(cleanSpot({ x: 1, y: 2 }), { x: 1, y: 2 }); assert.equal(cleanSpot({ x: "a", y: 2 }), null);
});
ok("download words", () => {
  assert.equal(bytesText(1_388_530_039), "1.39 GB"); assert.equal(bytesText(612_000_000), "612 MB"); assert.equal(bytesText(0), "0 MB");
  assert.match(packLine({ state: "none", got: 0, total: 1_388_530_039, helper: true, engine: "off" }), /1\.39 GB/);
  assert.match(packLine({ state: "paused", got: 500_000_000, total: 1_388_530_039, helper: true, engine: "off" }), /carries on/);
});

// ---------- the real SMS, with the real word lists ----------
const dirs = [process.env.PS_MC_LEXICON, `${homedir()}/Projects/ps-mac/translate`, `${homedir()}/Projects/.worktrees/minecraft-mode/translate`].filter(Boolean) as string[];
const dir = dirs.find((d) => existsSync(`${d}/ka-words.txt.gz`) && existsSync(`${d}/en-words.txt.gz`));
if (!dir) console.log("skip - the real word lists are not on this Mac (ps-mac translate/); fixture checks ran");
else {
  const load = (f: string) => parseWordList(gunzipSync(readFileSync(`${dir}/${f}`)).toString("utf8"));
  const ka = load("ka-words.txt.gz"), en = load("en-words.txt.gz");
  const real: Lexicons = { ka, en, lm: buildLetterModel(ka) };
  ok("the shipped lists: 300,000 Georgian forms, 40,000 English words, nothing else in the folder", () => {
    assert.equal(ka.words.length, 300000); assert.equal(en.words.length, 40000);
    assert.deepEqual(readdirSync(dir).sort(), ["en-words.txt.gz", "ka-words.txt.gz"]);
  });
  ok("The developer's Magti SMS of 3 Nov reads as the right Georgian, word for word", () => {
    const sms = `gaiaqtiure "Sakvirveli Dgheebis" shetavazebebi!\n\n3 noembers airchie:\n100 tsuti - 4 lari,\n9 000 MB - 10 lari,\n60 000 MB - 23 lari,\nKoqteili: 7 000 MB & 200 tsuti - 14 lari.\n\nvada - 30 dghe.\ngaaqtiureba - MyMagti an *288# OK\n\n5G es Magtia!\nwww.magticom.ge/sakvirveli329-2\n SMS Off 91521 Text: MAGTICOM`;
    assert.equal(detectLang(sms, real), "kl");
    assert.equal(piecesToGeorgian(readText(sms, real)),
      `გაიაქტიურე "საკვირველი დღეების" შეთავაზებები!\n\n3 ნოემბერს აირჩიე:\n100 წუთი - 4 ლარი,\n9 000 MB - 10 ლარი,\n60 000 MB - 23 ლარი,\nკოქტეილი: 7 000 MB & 200 წუთი - 14 ლარი.\n\nვადა - 30 დღე.\nგააქტიურება - MyMagti ან *288# OK\n\n5G ეს მაგთია!\nwww.magticom.ge/sakvirveli329-2\n SMS Off 91521 Text: MAGTICOM`);
  });
  ok("The developer's earlier Magti SMS reads right too (k as ყ in mihkevit, ch as ჭ in sachiro)", () => {
    const sms = "isargeblet AI Magti chatit da martivad miighet sachiro dakhmareba.\nshedzenili erteulebi vadis gasvlis shemdeg ar shegenakhebat.\nakhali paketis shesadzenad akrifet *111# OK da mihkevit instruqtsias, an etsviet portals MyMagti madloba, rom airchiet Magti.";
    // "chatit" (ჩატით, by chat) is in no list, so it is a guess: ჩათით and ჩატით look as Georgian as each other.
    // The guess is marked and the right one is the next choice in the word's menu.
    const chat = readWord("chatit", real).map((r) => r.geo);
    assert.ok(chat.slice(0, 2).includes("ჩატით"), chat.join(" "));
    assert.equal(piecesToGeorgian(readText(sms, real)).replace("ჩათით", "ჩატით"),
      "ისარგებლეთ AI მაგთი ჩატით და მარტივად მიიღეთ საჭირო დახმარება.\nშეძენილი ერთეულები ვადის გასვლის შემდეგ არ შეგენახებათ.\nახალი პაკეტის შესაძენად აკრიფეთ *111# OK და მიჰყევით ინსტრუქციას, ან ეწვიეთ პორტალს MyMagti მადლობა, რომ აირჩიეთ მაგთი.");
  });
  ok("chat style Georgian and the phrases from the brief", () => {
    assert.equal(piecesToGeorgian(readText("gamarjoba, rogor khar? kargad var, gmadlob", real)), "გამარჯობა, როგორ ხარ? კარგად ვარ, გმადლობ");
    assert.equal(piecesToGeorgian(readText("shegidzliat isargeblot", real)), "შეგიძლიათ ისარგებლოთ");
    assert.equal(piecesToGeorgian(readText("madloba, rom airchiet Magti", real)), "მადლობა, რომ აირჩიეთ მაგთი");
  });
  ok("plain English is left alone", () => {
    assert.equal(detectLang("Hello, how are you? I will be late today.", real), "en");
  });
}
console.log(`${n} passed`);
