// Run: node --experimental-strip-types tests/purchases.test.ts
// Purchases (PS 1.65, core/receipts.ts and core/purchases.ts): what a saved receipt is, the sums, the charts' numbers, the table, and the
// guards around the feature (an owner only record, the photo kept out of it, the switch, no dashes). Every receipt here is made up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const R = await import("../src/core/receipts.ts");
const S = await import("../src/core/purchases.ts");
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const rc = (id: string, shop: string, date: string, total: number, items: [string, number, number?][], cur = "GEL", at = date + "T10:00:00Z"): { id: string; r: ReturnType<typeof R.cleanReceipt> & object } =>
  ({ id, r: R.cleanReceipt({ v: 1, shop, date, total, cur, items: items.map(([n, p, q]) => ({ n, p, ...(q ? { q } : {}) })), at, src: "scan" })! });
const TODAY = "2026-11-17";
const LIST = [
  rc("a", "Nikora", "2026-11-03", 1205, [["რძე 1ლ", 320], ["პური", 150], ["Milk 1L", 330]]),
  rc("b", "Nikora", "2026-11-10", 800, [["რძე 2ლ", 640], ["Tea", 160]]),
  rc("c", "Spar", "2026-10-28", 4000, [["Tea", 400, 2], ["Rice 1kg", 900]]),
  rc("d", "Spar", "2026-10-02", 1000, [["Bread", 100]]),
  rc("e", "Fresco", "2026-09-15", 2500, []),
  rc("f", "Hotel", "2026-11-12", 9900, [], "USD"),
  rc("g", "", "2026-11-14", 500, [["Gum", 500]]),
];

await ok("a saved receipt is cleaned: bad money, bad dates, long text and junk are dropped", () => {
  assert.equal(R.cleanReceipt(null), null);
  assert.equal(R.cleanReceipt({ date: "17.11.2026", total: 100 }), null);
  assert.equal(R.cleanReceipt({ date: "2026-11-17", total: 12.5 }), null, "money is whole minor units");
  const r = R.cleanReceipt({ v: 1, shop: "  Nikora\n\u0000 ", date: "2026-11-17", total: 100, cur: "eur", items: [{ n: "x", p: 1.5 }, { n: "Tea", p: 100, q: 1 }, { n: "", p: 5 }, 7], ph: "../../etc", at: "nonsense", src: "x", extra: 1 })!;
  assert.equal(r.shop, "Nikora"); assert.equal(r.cur, "EUR"); assert.equal(r.items.length, 1); assert.equal(r.items[0].q, undefined);
  assert.equal(r.ph, undefined, "a photo id with slashes is refused"); assert.equal(r.src, "scan");
  assert.equal(R.cleanReceipt({ date: "2026-11-17", total: 100, ph: "abc123XYZ_-" })!.ph, "abc123XYZ_-");
  assert.equal((R.cleanReceipt({ date: "2026-11-17", total: 1, items: Array.from({ length: 500 }, () => ({ n: "a", p: 1 })) }))!.items.length, R.RC.itemsMax);
});

await ok("the check screen: a draft turns into a receipt, or says what is wrong", () => {
  const d = R.draftOf({ shop: "Spar", date: "2026-11-17", total: 1250, cur: "GEL", items: [{ n: "Tea", p: 400, q: 2 }] });
  assert.equal(d.total, "12.50"); assert.equal(d.items[0].q, "2");
  const good = R.receiptOfDraft(d, new Date("2026-11-17T12:00:00Z"), "scan", "photoid123");
  assert.ok("ok" in good && good.ok.total === 1250 && good.ok.items[0].q === 2 && good.ok.ph === "photoid123");
  assert.deepEqual((R.receiptOfDraft({ ...d, total: "abc", date: "" }, new Date(), "typed") as { bad: string[] }).bad, ["date", "total"]);
  assert.deepEqual((R.receiptOfDraft({ ...d, items: [{ n: "x", q: "", p: "zz" }] }, new Date(), "typed") as { bad: string[] }).bad, ["item-price"]);
  assert.ok("ok" in R.receiptOfDraft({ ...d, total: "1 234,50", items: [{ n: "", q: "", p: "" }] }, new Date(), "typed"), "empty item rows are skipped; 1 234,50 is a number");
  assert.equal(R.typedMoney("12"), 1200); assert.equal(R.typedMoney("12.5"), 1250); assert.equal(R.typedMoney(""), null);
});

await ok("the switch: the registry and Settings must both allow it, a missing setting is on", () => {
  assert.equal(R.receiptsOn(true, undefined), true);
  assert.equal(R.receiptsOn(true, false), false);
  assert.equal(R.receiptsOn(false, undefined), false);
  assert.equal(R.defaultCurrency(undefined), "GEL"); assert.equal(R.defaultCurrency("usd"), "USD");
  assert.equal(R.fmtMoney(123450, "GEL"), "1 234.50 GEL"); assert.equal(R.fmtMoney(-5, "USD"), "-0.05 USD");
});

await ok("the main currency: the preferred one when it is there, else the commonest; others are counted as left out", () => {
  assert.equal(S.mainCurrency(LIST, "GEL"), "GEL");
  assert.equal(S.mainCurrency(LIST, "EUR"), "GEL", "EUR has none, the commonest wins");
  assert.equal(S.mainCurrency([], "GEL"), "GEL");
  assert.equal(S.leftOut(LIST, "GEL"), 1);
});

await ok("this month and last month, and the difference", () => {
  const m = S.monthCompare(LIST, "GEL", TODAY);
  assert.equal(m.month, "2026-11"); assert.equal(m.prev, "2026-10");
  assert.equal(m.spent, 1205 + 800 + 500); assert.equal(m.before, 5000);
  assert.equal(m.diff, 2505 - 5000); assert.equal(m.pct, -49.9);
  assert.equal(S.monthCompare([], "GEL", TODAY).pct, null);
  assert.equal(S.monthCompare(LIST, "GEL", "2027-01-05").prev, "2026-12", "January looks back to December");
  assert.equal(S.monthCompare(LIST, "USD", TODAY).spent, 9900, "a currency of its own is summed alone");
});

await ok("spending by shop and by month", () => {
  assert.deepEqual(S.byShop(LIST, "GEL"), [{ label: "Spar", value: 5000 }, { label: "Nikora", value: 2005 }, { label: "Fresco", value: 2500 }, { label: "No shop name", value: 500 }].sort((a, b) => b.value - a.value));
  assert.equal(S.byShop(LIST, "GEL", 2).length, 2); assert.equal(S.byShop(LIST, "GEL", 2)[1].label, "Other");
  const m = S.byMonth(LIST, "GEL", TODAY, 4);
  assert.deepEqual(m.map((x) => x.label), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(m.map((x) => x.value), [0, 2500, 5000, 2505]);
  assert.equal(S.byMonth(LIST, "GEL", TODAY, 12).length, 12);
});

await ok("most bought items group the same thing written two ways and ignore sizes", () => {
  const t = S.topItems(LIST, "GEL");
  assert.equal(S.itemKey("Rice 1kg"), "rice"); assert.equal(S.itemKey("რძე 1ლ"), "რძე"); assert.equal(S.itemKey("  TEA!! "), "tea");
  assert.deepEqual([t[0].key, t[0].times], ["რძე", 2], "two receipts, size left out");
  assert.equal(t.find((x) => x.key === "tea")!.times, 2); assert.equal(t.find((x) => x.key === "tea")!.qty, 3, "1 plus 2");
  assert.equal(t.find((x) => x.key === "tea")!.spent, 560);
  assert.ok(!t.some((x) => x.key === "gum" && x.times > 1));
  assert.equal(S.topItems(LIST, "GEL", 2).length, 2);
});

await ok("recent purchases: newest day first, then newest saved", () => {
  assert.deepEqual(S.recent(LIST, 3).map((x) => x.id), ["g", "f", "b"]);
  const tie = [rc("x", "A", "2026-11-01", 1, [], "GEL", "2026-11-01T08:00:00Z"), rc("y", "B", "2026-11-01", 1, [], "GEL", "2026-11-01T09:00:00Z")];
  assert.deepEqual(S.recent(tie).map((x) => x.id), ["y", "x"]);
});

await ok("the table: receipts or items, sorted by any column, filtered, searched", () => {
  const q = S.defaultQuery();
  assert.deepEqual(S.tableRows(LIST, q).map((r) => r.id), ["g", "f", "b", "a", "c", "d", "e"]);
  assert.deepEqual(S.tableRows(LIST, { ...q, sort: "amount", dir: "desc" }).map((r) => r.id).slice(0, 2), ["f", "c"]);
  assert.deepEqual(S.tableRows(LIST, { ...q, sort: "shop", dir: "asc" }).map((r) => r.shop).slice(0, 3), ["", "Fresco", "Hotel"]);
  assert.deepEqual(S.tableRows(LIST, { ...q, shop: "Spar" }).map((r) => r.id), ["c", "d"]);
  assert.deepEqual(S.tableRows(LIST, { ...q, from: "2026-11-01", to: "2026-11-10" }).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(S.tableRows(LIST, { ...q, text: "TEA" }).map((r) => r.id), ["b", "c"], "search finds an item on a receipt, any case");
  assert.deepEqual(S.tableRows(LIST, { ...q, text: "nikora" }).map((r) => r.id), ["b", "a"]);
  const items = S.tableRows(LIST, { ...q, mode: "items", text: "tea", sort: "amount", dir: "desc" });
  assert.deepEqual(items.map((r) => [r.name, r.amount]), [["Tea", 400], ["Tea", 160]]);
  assert.equal(items[0].qty, 2);
  assert.equal(S.tableRows(LIST, { ...q, mode: "items" }).length, 3 + 2 + 2 + 1 + 1);
  assert.deepEqual(S.shopsOf(LIST), ["Fresco", "Hotel", "Nikora", "Spar"]);
  assert.equal(S.clickSort(q, "date").dir, "asc"); assert.deepEqual([S.clickSort(q, "shop").sort, S.clickSort(q, "shop").dir], ["shop", "asc"]);
  assert.equal(S.clickSort(q, "amount").dir, "desc");
});

await ok("the receipt is an owner only record, and the photo is never inside it", () => {
  const v = read("../src/core/vault.ts"), m = read("../src/core/model.ts");
  assert.match(v.split("const OWNER_KINDS")[1].split("]);")[0], /"rcpt"/);
  assert.match(m, /\| "rcpt"/);
  assert.equal(R.RCPT_KIND, "rcpt");
  assert.doesNotMatch(read("../src/core/receipts.ts").split("export interface Receipt")[1].split("}")[0], /data:image|base64/);
  assert.ok(R.RC.photoBytes <= 100_000, "about 90 KB");
});

await ok("the Tab list may write receipts (checked again on the main page), and gets them in its copy", () => {
  const ps = read("../src/ps.ts");
  assert.match(ps, /const TAB_KINDS = new Set<string>\(\[\.\.\.FIT_KINDS, RCPT_KIND\]\)/);
  assert.match(ps, /w\.kind === RCPT_KIND \? cleanReceipt\(w\.data\)/);
  assert.match(ps, /d\.kind === "rcpt"/);
  assert.match(ps, /typeof p\.receipts === "boolean"/);
});

await ok("Esc and Back close every Purchases screen, and the switch hides the button", () => {
  const sc = read("../src/views/ReceiptScan.tsx"), pu = read("../src/views/Purchases.tsx");
  assert.match(sc, /e\.key !== "Escape"/); assert.match(sc, /"gos-back"/);
  assert.match(pu, /useCloseKeys\(sub === null, onClose\)/);
  assert.match(pu, /if \(!on\) return null/);
  assert.match(read("../src/receipts.ts"), /receiptsOn\(feature\(RCPT_FEATURE\), settingsData\(v\)\.receipts\)/);
  assert.match(read("../../features.json"), /"id": "receipts"/);
  assert.match(read("../../FEATURES.md"), /Receipts and Purchases/);
});

await ok("a failed photo save never makes a second receipt: the second Save writes the same one, and says clearly what happened", () => {
  const sc = read("../src/views/ReceiptScan.tsx");
  assert.match(sc, /id: id \?\? done\.current\.id/);
  assert.match(sc, /done\.current = \{ id: out\.id, ph: out\.ph \}/);
  assert.match(sc, /noPhoto: "The receipt is saved, but its photo is not\. Tap Save to try the photo again/);
  assert.match(read("../src/receipts.ts"), /Promise<\{ id: string; photo: boolean; ph\?: string \}>/);
});

await ok("editing a receipt keeps its first save time, so it does not jump to the top of Recent purchases", () => {
  assert.match(read("../src/views/ReceiptScan.tsx"), /new Date\(at\)/);
  assert.match(read("../src/views/Purchases.tsx"), /<ReceiptCheck id=\{sub\.id\} at=\{sub\.r\.at\}/);
});

await ok("a receipt deleted in the Tab list deletes its sealed photo too; a photo that cannot be deleted is queued and tried again", () => {
  const ps = read("../src/ps.ts");
  assert.match(ps, /if \(have\.kind === RCPT_KIND\) await removeReceipt\(w\.id\)/);
  const rs = read("../src/receipts.ts");
  assert.match(rs, /catch \{ setOrphans\(addOrphan\(orphans\(\), ph\)\); \}/);
  assert.match(read("../src/views/Purchases.tsx"), /void flushOrphans\(\)/);
  assert.deepEqual(R.parseOrphans('["abcdef12","bad id","abcdef12"]'), ["abcdef12"]);
  assert.deepEqual(R.parseOrphans("not json"), []);
  assert.deepEqual(R.addOrphan(["abcdef12"], "zzzzzz99"), ["abcdef12", "zzzzzz99"]);
  assert.deepEqual(R.dropOrphan(["abcdef12", "zzzzzz99"], "abcdef12"), ["zzzzzz99"]);
});

await ok("no dashes in the Purchases files", () => {
  for (const p of ["../src/core/receipts.ts", "../src/core/purchases.ts", "../src/receipts.ts", "../src/views/Purchases.tsx", "../src/views/ReceiptScan.tsx", "../src/gos/receiptscan.ts", "./purchases.test.ts"]) assert.doesNotMatch(read(p), /[\u2013\u2014]/);
});

console.log(`purchases: ${n} passed`);
