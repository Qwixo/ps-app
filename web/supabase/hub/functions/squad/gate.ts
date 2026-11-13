// G Squad invite only (V1.57, migration invite_001_invite_only.sql): the edge function's join rules, with no database
// in them, so the unit test (tests/gsquad-invite.test.ts) checks the very rules the function runs. Deployed next to
// index.ts (the `squad` function is two files now).
//
// A member row is either admitted (in, or let in: everyone who was in on 13 Nov 2026, anyone who joined with a one
// time invite, anyone the admin let in) or waiting (a PS that joined by itself: that is its Ask to join). The database
// already refuses a key, a key drop or a card for a waiting row; these rules keep a waiting row from doing anything
// else either, so it never sees who is in, what they share or how much.

export interface Row { id: string; admitted: boolean }

/** What a waiting row may do: ask whether it got in (auto_key), leave its name for the admin (auto_ask), give up
 *  (leave, itself only). Everything else is refused with 403 "not let in" (never "not a member", which makes a PS
 *  start over). */
const WAITING_ACTS = new Set(["auto_key", "auto_ask", "leave"]);
export function allowedWhileWaiting(act: string, me: string, target: unknown): boolean {
  if (!WAITING_ACTS.has(act)) return false;
  return act !== "leave" || target === undefined || target === null || target === "" || target === me;
}
/** Acts only for an admitted row (the admin's answer to an ask, the new key handing steps). Listed for the test. */
export const ADMIN_ACTS = new Set(["wait_list", "admit", "turn_away"]);

/** The answer to "is my key here yet" for a waiting row: no key, never "make the first one", not the admin. The same
 *  shape V1.49+ apps read, so they simply keep waiting (every 3 minutes, a few dozen bytes). */
export function waitingKey(gen: number) {
  return { gen, start: false, drop: null, admin: false, admitted: false };
}

/** Leave, by who and whom:
 *    withdraw    a waiting row gives up: the row goes (no re-key, it never held the key)
 *    leave       an admitted member leaves (as before: out, then a re-key)
 *    turn_away   the admin answers an ask with no: the row goes and that join id cannot ask again by itself
 *    remove      the admin takes a member out (as before: out, re-key, their join id blocked) */
export type LeaveRoute = "withdraw" | "leave" | "turn_away" | "remove";
export function leaveRoute(me: Row, target: Row | null): LeaveRoute {
  if (!me.admitted) return "withdraw";
  if (!target || target.id === me.id) return "leave";
  return target.admitted ? "remove" : "turn_away";
}

/** The pulse's counts. k: admitted people waiting for the squad key (only for a member who holds it, so their PS hands
 *  it over). w: people asking to join (the admin only; V1.57+ shows them). Strangers never count towards k. */
export function pulseCounts(me: { has_key: boolean; admin: boolean }, keyWaiting: number, asking: number) {
  return { k: me.has_key ? keyWaiting : 0, w: me.admin ? asking : 0 };
}
