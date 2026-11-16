// Run: node --experimental-strip-types tests/receiptparse.test.ts
// Receipts (PS 1.65, core/receiptparse.ts): the shop, the date, the total and the items from text a phone read off a paper
// receipt. Every sample below is made up. Messy ones included: a reader that splits decimals, mixes up letters and digits,
// puts a name and its price on two lines, and Georgian, English, German and Russian words.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const P = await import("../src/core/receiptparse.ts");

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const TODAY = "2026-11-17";

await ok("amounts: points, commas, thousands, spaces", () => {
  assert.equal(P.amountToMinor("12.50"), 1250);
  assert.equal(P.amountToMinor("12,50"), 1250);
  assert.equal(P.amountToMinor("1 234,50"), 123450);
  assert.equal(P.amountToMinor("1.234,50"), 123450);
  assert.equal(P.amountToMinor("1,234.50"), 123450);
  assert.equal(P.amountToMinor("-3.20"), -320);
  assert.equal(P.amountToMinor("0.5"), 50);
  assert.equal(P.amountToMinor("7"), null, "a whole number is not a price unless asked");
  assert.equal(P.amountToMinor("7", true), 700);
  assert.equal(P.amountToMinor("1,234", true), 123400);
  assert.equal(P.amountToMinor("abc"), null);
});

await ok("tidy: other digits, split decimals, a letter O for a zero", () => {
  assert.equal(P.tidyLine("სულ ١٢.٥٠"), "სულ 12.50");
  assert.equal(P.tidyLine("Milk 3 .20"), "Milk 3.20");
  assert.equal(P.tidyLine("Milk 3,2O"), "Milk 3,20");
  assert.equal(P.tidyLine("a  b"), "a b");
  assert.equal(P.tidyLine("2 × 3.50"), "2 x 3.50");
});

await ok("dates in many shapes", () => {
  assert.deepEqual(P.datesIn("17.11.2026 14:32"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("დრო 17/11/26"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("2026-11-17T10:00"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("17 ნოემბერი 2026"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("17 Nov 2026"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("Nov 17, 2026"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("17. Dezember 2025"), ["2025-12-17"]);
  assert.deepEqual(P.datesIn("17 ноября 2026"), ["2026-11-17"], "a month is matched by its first letters, so endings do not matter");
  assert.deepEqual(P.datesIn("03/04/2026"), ["2026-04-03"], "day first by default");
  assert.deepEqual(P.datesIn("03/04/2026", "mdy"), ["2026-03-04"]);
  assert.deepEqual(P.datesIn("04/25/2026"), ["2026-04-25"], "a second number over 12 means month first");
  assert.deepEqual(P.datesIn("31.02.2026"), [], "no such day");
  assert.deepEqual(P.datesIn("Tel 555 12 34"), []);
});

await ok("the date: a date line wins, a date far in the future is not believed", () => {
  assert.equal(P.findDate(["Nikora", "12.01.2026", "თარიღი: 17.11.2026"], { today: TODAY }), "2026-11-17");
  assert.equal(P.findDate(["01.01.2090"], { today: TODAY }), "");
  assert.equal(P.findDate(["nothing here"], { today: TODAY }), "");
});

await ok("currency: a sign or code on the receipt, else the person's own choice, else lari", () => {
  assert.equal(P.currencyIn("Total 12.50 ₾"), "GEL");
  assert.equal(P.currencyIn("Total 12.50 EUR"), "EUR");
  assert.equal(P.currencyIn("Total $12.50"), "USD");
  assert.equal(P.currencyIn("nothing"), null);
  assert.equal(P.parseReceipt("Shop\nMilk 3.20\nTotal 3.20").cur, "GEL");
  assert.equal(P.parseReceipt("Shop\nMilk 3.20\nTotal 3.20", { currency: "usd" }).cur, "USD");
  assert.equal(P.parseReceipt("Shop\nMilk 3.20\nTotal 3.20 EUR", { currency: "USD" }).cur, "EUR", "the receipt wins");
  assert.equal(P.cleanCurrency("nonsense"), "GEL");
});

const GEORGIAN = `შპს ნიკორა ტრეიდი
ს/კ 204 45 55 94
ქ. თბილისი, ჭავჭავაძის გამზ. 12
ქვითარი N 0045678
თარიღი: 17.11.2026 18:42
კასა 3  მოლარე: ნინო
რძე 1ლ 3.20
პური თოთო 1.50
ბანანი
0.752 x 4.99 3.75
წყალი ბორჯომი 0.5ლ
2 x 1.80 3.60
სულ 12.05
ნაღდი 20.00
ხურდა 7.95
დღგ 18% 1.84
მადლობა შენაძენისთვის`;

await ok("a Georgian receipt: shop, date, total, items with a quantity line under the name", () => {
  const r = P.parseReceipt(GEORGIAN, { today: TODAY });
  assert.equal(r.shop, "Nikora");
  assert.equal(r.date, "2026-11-17");
  assert.equal(r.total, 1205);
  assert.equal(r.cur, "GEL");
  assert.deepEqual(r.items.map((i) => [i.n, i.p]), [["რძე 1ლ", 320], ["პური თოთო", 150], ["ბანანი", 375], ["წყალი ბორჯომი 0.5ლ", 360]]);
  assert.equal(r.items[3].q, 2);
  assert.deepEqual(r.warn, []);
});

const ENGLISH = `FRESH MARKET LLC
123 High Street
Date 03.11.2026
Tel: +1 555 010 2030
Apples 2 x 1.25  2.50
Bread  3.10
Cheese 200g 4,80
Subtotal 10.40
VAT 8% 0.77
TOTAL 10.40
Card ****1234 10.40
THANK YOU`;

await ok("an English receipt: subtotal and tax lines are not the total, card line is not an item", () => {
  const r = P.parseReceipt(ENGLISH, { today: TODAY });
  assert.equal(r.shop, "FRESH MARKET LLC");
  assert.equal(r.date, "2026-11-03");
  assert.equal(r.total, 1040);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].q, 2);
  assert.equal(r.items[2].p, 480);
  assert.deepEqual(r.warn, []);
});

await ok("a German receipt with a comma and a Russian one", () => {
  const de = P.parseReceipt("Bäckerei Müller\n17.11.2026\nBrötchen 0,45\nKaffee 2,80\nSumme EUR 3,25\nBar 5,00\nRückgeld 1,75", { today: TODAY });
  assert.equal(de.cur, "EUR");
  assert.equal(de.total, 325);
  assert.equal(de.date, "2026-11-17");
  assert.equal(de.shop, "Bäckerei Müller");
  const ru = P.parseReceipt("Магазин Радуга\n17.11.2026\nХлеб 45,00\nМолоко 89,90\nИТОГО 134,90\nНаличными 200,00\nСдача 65,10", { today: TODAY });
  assert.equal(ru.total, 13490);
  assert.equal(ru.items.length, 2);
});

await ok("a messy read: split decimals, a letter O, junk lines, no shop name on top, the total on the next line", () => {
  const messy = `~~ ' .
Goodwi11 supermarket
17 / 11 / 2O26
Mi1k 3 .2O
Bread 1,5O
Eggs 10pc 6 ,90

სულ
11.60
-- - `;
  const r = P.parseReceipt(messy, { today: TODAY });
  assert.equal(r.total, 1160, "the figure on the line after the word");
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].p, 320);
  assert.equal(r.items[1].p, 150);
  assert.equal(r.items[2].p, 690);
});

await ok("no total word at all: the items add up, flagged as a guess", () => {
  const r = P.parseReceipt("Corner shop\n17.11.2026\nTea 2.00\nSugar 3.50", { today: TODAY });
  assert.equal(r.total, 550);
  assert.ok(r.warn.includes("total-guessed"));
});

await ok("the total picked is the one that matches the items when two words compete", () => {
  const r = P.parseReceipt("Shop X\n17.11.2026\nTea 5.00\nRice 5.00\nსულ 10.00\nTotal paid 12.00", { today: TODAY });
  assert.equal(r.total, 1000);
});

await ok("nothing readable gives empty answers and warnings, never a throw", () => {
  const r = P.parseReceipt("", {});
  assert.equal(r.total, null); assert.equal(r.items.length, 0); assert.equal(r.date, "");
  assert.ok(r.warn.includes("no-total") && r.warn.includes("no-date") && r.warn.includes("no-items"));
  assert.doesNotThrow(() => P.parseReceipt("\u0000￿ 99999999999999999999.99 ".repeat(50), {}));
  assert.doesNotThrow(() => P.parseReceipt(String(undefined as unknown as string)));
});

await ok("an item sum that is not the total is flagged for the check screen", () => {
  const r = P.parseReceipt("Shop X\n17.11.2026\nTea 5.00\nRice 5.00\nTotal 25.00", { today: TODAY });
  assert.ok(r.warn.includes("sum-differs"));
});

await ok("a known shop name in Latin or Georgian wins, a word that only contains it does not", () => {
  assert.equal(P.findShop(["კარფური გლდანი", "ქვითარი"]), "Carrefour");
  assert.equal(P.findShop(["Sparkling Water Co", "Total"]), "Sparkling Water Co");
  assert.equal(P.findShop(["SPAR Vake"]), "Spar");
});

await ok("more real life shapes: dot leaders, lari sign on prices, weight lines, numbered lists, a service charge, two digit years", () => {
  const a = P.parseReceipt(`სს გუდვილი\nქ. თბილისი\n17-11-2026  12:05\nხაჭაპური ........ 6.50 ₾\nლიმონათი 0.5ლ   2,20 ლ\nქათმის ფილე 0.835კგ x 14.90   12.44\nჯამი: 21.14 ₾\nგადახდილი ბარათით 21.14`, { today: TODAY });
  assert.equal(a.shop, "Goodwill"); assert.equal(a.date, "2026-11-17"); assert.equal(a.total, 2114);
  assert.deepEqual(a.items.map((i) => [i.n, i.p]), [["ხაჭაპური", 650], ["ლიმონათი 0.5ლ", 220], ["ქათმის ფილე 0.835კგ", 1244]]);
  const b = P.parseReceipt("SUPERMARKET ABC\nDate: 2026/11/15\n1 Coca Cola 0.5l 2.50\n2 Chips Lays 3.10\n3 Mineral water 1.00\nTotal: 6.60 GEL\nVisa 6.60", { today: TODAY });
  assert.deepEqual(b.items.map((i) => i.n), ["Coca Cola 0.5l", "Chips Lays", "Mineral water"]); assert.equal(b.total, 660);
  const c = P.parseReceipt("სუპერმარკეტი\n20.10.26\nპური 1.20\nრძე 3.50\nსულ გადასახდელი: 4.70 ₾\nბარათი 4.70", { today: TODAY });
  assert.equal(c.date, "2026-10-20"); assert.equal(c.total, 470); assert.equal(c.items.length, 2);
  const d = P.parseReceipt("Cafe Stamba\nNov 12 2026\nLatte 9.00\nCroissant 6.50\nService 10% 1.55\nTotal 17.05", { today: TODAY });
  assert.equal(d.total, 1705); assert.equal(d.date, "2026-11-12"); assert.equal(d.items.length, 3);
});

await ok("a total or skip word is matched as a whole word: sulguni, Martini, Dates, Cashew and other food are items", () => {
  const a = P.parseReceipt("NIKORA\n17.11.2026\nპური 2.50\nსულგუნი 12.50\nრძე 3.20\nსულ 18.20", { today: TODAY });
  assert.deepEqual(a.items.map((i) => i.n), ["პური", "სულგუნი", "რძე"]); assert.equal(a.total, 1820); assert.ok(!a.warn.includes("sum-differs"));
  const foods = ["Martini Bianco 14.00", "Dates 8.40", "Cashew nuts 11.90", "Cardamom 3.00", "Cashmere soap 6.00", "Taxi snack 2.00", "картофель 4.20", "ხაჭაპური 7.00", "ჩურჩხელა 5.00", "ხურმა 4.00", "ბონბონი 3.00", "ტკბილეული 2.50", "სულგუნის ყველი 9.00", "ჯემი ბალის 4.40"];
  for (const f of foods) {
    const r = P.parseReceipt(`Shop\n17.11.2026\nBread 2.00\n${f}\nTotal ${(200 + Math.round(parseFloat(f.match(/[\d.]+$/)![0]) * 100)) / 100}`, { today: TODAY });
    assert.ok(r.items.some((i) => f.startsWith(i.n)), `item kept: ${f}`);
  }
  const b = P.parseReceipt("Shop\n17.11.2026\nGeorgian wine 20.00\nსულ 20.00", { today: TODAY });
  assert.equal(b.total, 2000);
  assert.equal(P.parseReceipt("Shop\n17.11.2026\nTea 5.00\nTIN 123456789\nTel: 555 12 12 12\nVAT 0.90\nCash 10.00\nTotal 5.00", { today: TODAY }).items.length, 1, "real skip words still skip");
});

await ok("the lari sign and code are found, one stray dollar or euro never turns a lari receipt into dollars", () => {
  assert.equal(P.currencyIn("Shop\nსულ 12.50 ლ"), "GEL");
  assert.equal(P.currencyIn("ჯამი 12.50 ლ."), "GEL");
  assert.equal(P.currencyIn("Total 12.50 GEL"), "GEL");
  assert.equal(P.currencyIn("Total 12.50 ₾"), "GEL");
  assert.equal(P.parseReceipt("Shop\n17.11.2026\nპური 3.$0\nრძე 4.00\nსულ 12.50 ლ", { today: TODAY, currency: "EUR" }).cur, "GEL");
  assert.equal(P.parseReceipt("ნიკორა\n17.11.2026\nპური 3.50 €\nრძე 4.00\nსულ 7.50", { today: TODAY }).cur, "GEL", "one stray sign on a Georgian receipt is not believed");
  assert.equal(P.currencyIn("Shop\nTea $3.00\nCoffee $4.00\nTotal $7.00"), "USD", "a real dollar receipt is still dollars");
  assert.equal(P.currencyIn("Shop\nTotal USD 7.00"), "USD");
  assert.equal(P.currencyIn("Shop\nTea 3.00 TL"), "TRY");
  assert.equal(P.currencyIn("Shop\nTea 3.00"), null);
  assert.equal(P.currencyIn("Shop ლ 7.00 $"), "GEL");
});

await ok("a month is a whole word: Market is not March, real month names and short forms still work", () => {
  assert.equal(P.datesIn("12 Market 24").length, 0);
  assert.deepEqual(P.datesIn("12 Mar 2026"), ["2026-03-12"]);
  assert.deepEqual(P.datesIn("12 March 2026"), ["2026-03-12"]);
  assert.deepEqual(P.datesIn("Sept 3, 2026"), ["2026-09-03"]);
  assert.deepEqual(P.datesIn("17 ნოემბერი 2026"), ["2026-11-17"]);
  assert.deepEqual(P.datesIn("5 января 2026"), ["2026-01-05"]);
  assert.equal(P.datesIn("3 Decor 2026").length, 0);
});

await ok("no dashes in the receipt parser or its test", () => {
  for (const p of ["../src/core/receiptparse.ts", "./receiptparse.test.ts"]) assert.doesNotMatch(readFileSync(new URL(p, import.meta.url), "utf8"), /[\u2013\u2014]/);
});

console.log(`receiptparse: ${n} passed`);
