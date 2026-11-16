// DEV ONLY: made up receipts to look at the Purchases screen (App.tsx /dev-purchases). Never imported in a production build.
import type { Doc } from "../core/model";
import type { Receipt } from "../core/receipts";

const SHOPS: { shop: string; items: [string, number][] }[] = [
  { shop: "Nikora", items: [["რძე 1ლ", 320], ["პური თოთო", 150], ["ყველი სულგუნი", 1280], ["ბანანი", 375], ["წყალი ბორჯომი", 180]] },
  { shop: "Carrefour", items: [["Milk 1L", 340], ["Bread", 160], ["Eggs 10", 690], ["Tomatoes", 520], ["Coffee beans", 2490]] },
  { shop: "Spar", items: [["Tea", 400], ["Rice 1kg", 900], ["Olive oil", 2300], ["Yogurt", 210]] },
  { shop: "Agrohub", items: [["Apples", 450], ["Potatoes", 280], ["Cheese", 1150], ["Bread", 150]] },
  { shop: "Aversi", items: [["Vitamin C", 1450], ["Plasters", 380]] },
];

export function fakeReceipts(now = new Date()): Doc[] {
  const out: Doc[] = [];
  let k = 0;
  for (let i = 0; i < 26; i++) {
    const s = SHOPS[(i * 3 + (i >> 2)) % SHOPS.length];
    const d = new Date(now.getTime() - (i * 5.3 + 1) * 86400_000);
    const items = s.items.filter((_, j) => (i + j) % 3 !== 0 || j < 2).map(([n, p]) => ({ n, p }));
    const total = items.reduce((a, x) => a + x.p, 0);
    const r: Receipt = { v: 1, shop: s.shop, date: d.toISOString().slice(0, 10), total, cur: "GEL", items, at: d.toISOString(), src: "scan" };
    out.push({ id: `dev-rcpt-${++k}`, ws: null, kind: "rcpt", data: r, author: "dev", updatedAt: d.toISOString() });
  }
  const t = new Date(now.getTime() - 9 * 86400_000);
  out.push({ id: `dev-rcpt-${++k}`, ws: null, kind: "rcpt", data: { v: 1, shop: "Hotel Batumi", date: t.toISOString().slice(0, 10), total: 18000, cur: "USD", items: [], at: t.toISOString(), src: "typed" } satisfies Receipt, author: "dev", updatedAt: t.toISOString() });
  return out;
}
