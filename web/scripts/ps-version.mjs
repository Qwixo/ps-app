// The one PS version for the Mac and the phone, with its numerology keyword (ps-version.json,
// scripts/ps-keywords.json). `node scripts/ps-version.mjs` prints {"version","name","keyword"};
// `node scripts/ps-version.mjs bump` adds 0.01, gives the new version the next keyword of its
// number that no version has had before (the developer: unique every time), and saves both.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "ps-version.json");
const words = JSON.parse(readFileSync(join(root, "scripts/ps-keywords.json"), "utf8"));

/** The numerology number of a version: the part after the dot, reduced unless it is 11, 22 or 33. */
export function numberOf(version) {
  let n = Number(String(version).split(".")[1] || 0);
  while (n > 9 && ![11, 22, 33].includes(n)) n = String(n).split("").reduce((a, d) => a + Number(d), 0);
  return n;
}

/** The first word of the version's number that is not in used; past the list, "Wisdom II", "Wisdom III"... */
export function keywordFor(version, used) {
  const list = words[String(numberOf(version))] || [];
  const taken = new Set(Object.values(used || {}).map((w) => w.toLowerCase()));
  for (let round = 1; round < 50; round++) {
    const roman = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][round];
    const suffix = round === 1 ? "" : ` ${roman || round}`;
    for (const w of list) if (!taken.has((w + suffix).toLowerCase())) return w + suffix;
  }
  return "";
}

const isMain = !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.names ||= {};
  if (process.argv[2] === "bump") {
    const [major, minor] = data.version.split(".").map(Number);
    data.version = `${major}.${String(minor + 1).padStart(2, "0")}`;
  }
  if (!data.names[data.version]) {
    const others = Object.fromEntries(Object.entries(data.names).filter(([v]) => v !== data.version));
    data.names[data.version] = keywordFor(data.version, others);
    if (process.argv[2] === "bump") writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
  }
  process.stdout.write(JSON.stringify({ version: data.version, name: `V${data.version}`, keyword: data.names[data.version] }) + "\n");
}
