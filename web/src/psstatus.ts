// The "PS is active" pop-up's status, the engine page half (core/psstatus.ts says what; ps-mac
// Popup.swift draws it). Posts {type:"psStatus", state} whenever it changes, and once a minute so the
// next meeting moves on and a restarted native side catches up. Locked or signed out: open false, nothing else.
import { vaultStore } from "./core/vault";
import { calendarSnap, settingsData } from "./core/select";
import { visibleEvents } from "./core/meethide";
import { meetingEvents } from "./core/calpick";
import { psStatus } from "./core/psstatus";

let last = "";

export function startPsStatus(post: (m: object) => void) {
  const send = () => {
    const s = vaultStore.get();
    const open = s.status === "unlocked" && s.role === "owner";
    const state = psStatus({
      open, online: s.online, lastSync: s.lastSync, pending: s.pendingCount, syncError: s.syncError,
      events: open ? visibleEvents(meetingEvents(calendarSnap(s)?.data.events ?? [], settingsData(s).calChoices), settingsData(s).meetHidden) : [], privateMode: open && settingsData(s).privateMode === true, now: Date.now(),
    });
    const json = JSON.stringify(state);
    if (json === last) return;
    last = json;
    post({ type: "psStatus", state });
  };
  vaultStore.subscribe(send);
  window.setInterval(send, 60_000);
  send();
}
