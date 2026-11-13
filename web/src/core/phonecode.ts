// Pure helper for GOS phone enrolment (src/gos/cmdsign.ts re-exports it).
/** The six digit code the phone shows while the developer trusts it on a Mac; the Mac's alert shows the same
 *  (Second Computer protocol section 2, with the Mac as "primary" and the phone as "secondary"). */
export async function phoneCode(macPub: string, phonePub: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ps-second-pair-v1\n${macPub}\n${phonePub}`)));
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  const s = String(n % 1_000_000).padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}
