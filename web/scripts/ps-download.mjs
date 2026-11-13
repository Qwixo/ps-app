// The PS download page and install script (ps-download/) are public copy: they deploy only after the developer said
// yes to the exact words (31 Oct 2026). ps-download/approved.json holds the SHA-256 of every file that
// deploys; any change after his yes, or no file at all (the default), deploys none of them (postbuild.mjs).
//   node scripts/ps-download.mjs show            the files and their one hash (show the developer the words first)
//   node scripts/ps-download.mjs approve <hash>  ONLY after the developer's yes: records that exact hash
//   node scripts/ps-download.mjs revoke          takes the approval back (nothing deploys)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const DIR = "ps-download";
export const files = () => ["install.sh", "ps-verify.js", ...readdirSync(`${DIR}/download`).sort().map((f) => `download/${f}`)];
export function digest() {
  const h = createHash("sha256");
  for (const f of files()) h.update(f + "\0").update(readFileSync(`${DIR}/${f}`)).update("\0");
  return h.digest("hex");
}
export function approved() {
  try { return JSON.parse(readFileSync(`${DIR}/approved.json`, "utf8")).sha256 === digest(); } catch { return false; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "show") {
    console.log(files().join("\n"));
    console.log(`\nhash ${digest()}\napproved: ${approved() ? "yes" : "no"}`);
  } else if (cmd === "approve" && arg) {
    if (arg !== digest()) { console.error("That hash is not the current files' hash: show them again."); process.exit(1); }
    writeFileSync(`${DIR}/approved.json`, JSON.stringify({ sha256: arg, at: new Date().toISOString() }, null, 1) + "\n");
    console.log("Approved: the download page and install.sh deploy with the next release.");
  } else if (cmd === "revoke") {
    if (existsSync(`${DIR}/approved.json`)) rmSync(`${DIR}/approved.json`);
    console.log("Not approved: nothing from ps-download/ deploys.");
  } else { console.error("usage: ps-download.mjs show | approve <hash> | revoke"); process.exit(1); }
}
