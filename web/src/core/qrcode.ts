// A QR code drawn on this device (Add friend, V1.44): no library and no outside service ever sees the link, which
// holds a G Squad invite key after its #. Byte mode, versions 1 to 20, error correction M by default (a phone camera
// reads it off a screen at arm's length). The steps follow the QR standard (ISO 18004): data bits, Reed Solomon
// error correction per block, interleaving, the fixed patterns, the zigzag placement, then the mask with the lowest
// penalty. Pure: no DOM. qrPath() turns the grid into one SVG path.

export type Ecc = "L" | "M" | "Q" | "H";
const ECC_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };
// Index 0 unused; versions 1 to 20.
const ECC_PER_BLOCK: Record<Ecc, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
};
const BLOCKS: Record<Ecc, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
};
export const QR_MAX_VERSION = 20;

/** Modules that carry data or error correction (everything but the fixed patterns and the format and version bits). */
export function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
export const dataCodewords = (ver: number, ecc: Ecc) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver] * BLOCKS[ecc][ver];
export const eccBlocks = (ver: number, ecc: Ecc) => ({ blocks: BLOCKS[ecc][ver], eccLen: ECC_PER_BLOCK[ecc][ver] });

/** Where the alignment patterns sit (their centres, the same list across and down). */
export function alignAt(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let p = ver * 4 + 10; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

// ---------- Reed Solomon over GF(256), polynomial 0x11D ----------
export function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
}
function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 2);
  }
  return r;
}
export function rsRemainder(data: number[], degree: number): number[] {
  const div = rsDivisor(degree);
  const r = new Array<number>(degree).fill(0);
  for (const b of data) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

// ---------- data ----------
function utf8(text: string): number[] { return [...new TextEncoder().encode(text)]; }
const countBits = (ver: number) => (ver <= 9 ? 8 : 16);
/** The smallest version that holds these bytes at this level, or null (too long for version 20). */
export function fitVersion(len: number, ecc: Ecc): number | null {
  for (let v = 1; v <= QR_MAX_VERSION; v++) if (4 + countBits(v) + len * 8 <= dataCodewords(v, ecc) * 8) return v;
  return null;
}
function dataBits(bytes: number[], ver: number, ecc: Ecc): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, countBits(ver));
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(ver, ecc) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
/** Data codewords split into blocks, each with its error correction, then read across the blocks. */
export function interleave(data: number[], ver: number, ecc: Ecc): number[] {
  const { blocks: nb, eccLen } = eccBlocks(ver, ecc);
  const raw = Math.floor(rawModules(ver) / 8);
  const short = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
    k += d.length;
    const e = rsRemainder(d, eccLen);
    if (i < short) d.push(0);
    blocks.push([...d, ...e]);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= short) out.push(b[i]); });
  return out;
}

// ---------- the grid ----------
export function formatBits(ecc: Ecc, mask: number): number {
  const d = (ECC_BITS[ecc] << 3) | mask;
  let r = d;
  for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
  return ((d << 10) | r) ^ 0x5412;
}
export function versionBits(ver: number): number {
  let r = ver;
  for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
  return (ver << 12) | r;
}
export const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  ver: number; size: number; dark: boolean[][]; fixed: boolean[][];
  constructor(ver: number) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, d: boolean) { this.dark[y][x] = d; this.fixed[y][x] = true; }
  patterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    const finder = (cx: number, cy: number) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < s && y >= 0 && y < s) this.set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(s - 4, 3); finder(3, s - 4);
    const at = alignAt(this.ver), last = at.length - 1;
    for (let i = 0; i < at.length; i++) for (let j = 0; j < at.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(at[i] + dx, at[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    this.format("M", 0);   // reserves the format areas (drawn again once the mask is known)
    if (this.ver >= 7) {
      const b = versionBits(this.ver);
      for (let i = 0; i < 18; i++) {
        const bit = ((b >>> i) & 1) === 1, a = s - 11 + (i % 3), c = Math.floor(i / 3);
        this.set(a, c, bit); this.set(c, a, bit);
      }
    }
  }
  format(ecc: Ecc, mask: number) {
    const b = formatBits(ecc, mask), s = this.size, bit = (i: number) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6)); this.set(8, 8, bit(7)); this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, bit(i));
    this.set(8, s - 8, true);   // the dark module
  }
  place(codewords: number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < s; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? s - 1 - v : v;
        if (!this.fixed[y][x] && i < codewords.length * 8) { this.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
  }
  mask(m: number) {
    const f = MASKS[m];
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fixed[y][x] && f(x, y)) this.dark[y][x] = !this.dark[y][x];
  }
}

/** How hard a grid is to read (lower is better): long runs, 2 by 2 blocks, finder look alikes, dark balance. */
export function penalty(g: boolean[][]): number {
  const s = g.length;
  let p = 0, dark = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) p += 3 + (run - 5);
      run = 1;
    }
    const a = [true, false, true, true, true, false, true, false, false, false, false];
    const b = [...a].reverse();
    for (let i = 0; i + 11 <= s; i++) {
      let ma = true, mb = true;
      for (let k = 0; k < 11; k++) { const v = get(i + k); if (v !== a[k]) ma = false; if (v !== b[k]) mb = false; }
      if (ma) p += 40;
      if (mb) p += 40;
    }
  };
  for (let y = 0; y < s; y++) line((i) => g[y][i]);
  for (let x = 0; x < s; x++) line((i) => g[i][x]);
  for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) {
    const c = g[y][x];
    if (c === g[y][x + 1] && c === g[y + 1][x] && c === g[y + 1][x + 1]) p += 3;
  }
  for (const row of g) for (const v of row) if (v) dark++;
  const total = s * s;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

export interface Qr { version: number; ecc: Ecc; mask: number; size: number; dark: boolean[][] }
/** The QR code for this text (UTF-8 bytes). Throws if it does not fit version 20. */
export function makeQr(text: string, ecc: Ecc = "M", mask?: number): Qr {
  const bytes = utf8(text);
  const ver = fitVersion(bytes.length, ecc);
  if (!ver) throw new Error("Too long for a QR code.");
  const cw = interleave(dataBits(bytes, ver, ecc), ver, ecc);
  let best: Grid | null = null, bestMask = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    if (mask !== undefined && m !== mask) continue;
    const g = new Grid(ver);
    g.patterns(); g.place(cw); g.mask(m); g.format(ecc, m);
    const p = penalty(g.dark);
    if (p < bestP) { best = g; bestP = p; bestMask = m; }
  }
  return { version: ver, ecc, mask: bestMask, size: best!.size, dark: best!.dark };
}

/** One SVG path for the dark modules, with a quiet zone of `margin` modules. viewBox is 0 0 n n (n = size + 2 margin). */
export function qrPath(q: Qr, margin = 4): { d: string; n: number } {
  let d = "";
  for (let y = 0; y < q.size; y++) {
    let x = 0;
    while (x < q.size) {
      if (!q.dark[y][x]) { x++; continue; }
      let w = 1;
      while (x + w < q.size && q.dark[y][x + w]) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h${-w}z`;
      x += w;
    }
  }
  return { d, n: q.size + margin * 2 };
}
