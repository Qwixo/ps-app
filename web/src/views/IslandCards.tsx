// V1.55 notifications out of the Dynamic Island (the developer, 12 Nov 2026: "I want it to come out with the dynamic island
// instead, but I also want to be able to customize it in the dynamic island settings. But I want it to be on by default.
// And if it's off then the notification comes on the top right"). Lives in the island's own settings: the Tab list's
// island menu and Settings > Mac > Dynamic Island, one synced vault setting (settings.island.cards and .top,
// core/island.ts). The main switch, then each kind of card with Island or Top right ("decide which notifications actually
// pop out the dynamic island and which notifications go on the top"), greyed out while the switch is off. Also the AI
// chat cards' own time (settings.chatFade, core/chatdone.ts), shown with the AI chat finished cards settings.
import { CARD_KINDS, cardPlace, withCardPlace, type IslandPrefs } from "../core/island";
import { CHAT_FADE_CHOICES, chatFade } from "../core/chatdone";
import { isRedAccount } from "../core/account";
import { useVault } from "../ui/kit";
import "./islandhide.css";
import "./islandcards.css";

/** Over a full screen app the island glides to the top left black band beside the notch (settings.island.fsMove, ps-mac
 *  Island.swift). The developer, 12 Nov 2026: "make it so the dynamic island does a fancy animation so it moves itself up to the
 *  top left of the screen instead". On by default, everyone's, in both island settings places.
 *  V1.58 words (a friend, 13 Nov 2026: "When I am on fullscreen of any app, I want it to be in that black bar"): the same
 *  setting, now called what it does. Since V1.58 the island can also be dragged into the top strip and the corners. */
export const ISLAND_FS_LABEL = "In full screen, sit in the top bar";
export const ISLAND_FS_HINT = "On: when the app in front is full screen, the island moves into the black strip at the top, left of the notch, and stays there. When full screen ends it goes back to where you put it. Off: it stays where it is, dimmed. Only a Mac with a notch has that strip.";
export function IslandFullScreenRow({ prefs, save }: { prefs: IslandPrefs; save: (p: IslandPrefs) => void }) {
  const islandOn = prefs.mode !== "off";
  const on = prefs.fsMove;
  return (
    <div className="ih-row" role="group" aria-label={ISLAND_FS_LABEL}>
      <span className="ih-l">{ISLAND_FS_LABEL}<em>{islandOn ? ISLAND_FS_HINT : "The island is off."}</em></span>
      <div className="ih-chips" role="radiogroup" aria-label={ISLAND_FS_LABEL}>
        <button type="button" role="radio" aria-checked={on} className={`ih-chip${on ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => { if (!on) save({ ...prefs, fsMove: true }); }}>On</button>
        <button type="button" role="radio" aria-checked={!on} className={`ih-chip${!on ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => { if (on) save({ ...prefs, fsMove: false }); }}>Off</button>
      </div>
    </div>
  );
}

/** The island's chime at its big moments: database loaded, update done, What's new (settings.island.sounds, PS 1.60). On by
 *  default. The small chimes cards already had keep their own switches. */
export const ISLAND_SOUNDS_LABEL = "Island sounds";
export const ISLAND_SOUNDS_HINT = "On: a soft chime when the island finishes loading your database, finishes an update, or opens What's new. Off: the island stays silent.";
export function IslandSoundsRow({ prefs, save }: { prefs: IslandPrefs; save: (p: IslandPrefs) => void }) {
  const islandOn = prefs.mode !== "off";
  const on = prefs.sounds;
  return (
    <div className="ih-row" role="group" aria-label={ISLAND_SOUNDS_LABEL}>
      <span className="ih-l">{ISLAND_SOUNDS_LABEL}<em>{islandOn ? ISLAND_SOUNDS_HINT : "The island is off."}</em></span>
      <div className="ih-chips" role="radiogroup" aria-label={ISLAND_SOUNDS_LABEL}>
        <button type="button" role="radio" aria-checked={on} className={`ih-chip${on ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => { if (!on) save({ ...prefs, sounds: true }); }}>On</button>
        <button type="button" role="radio" aria-checked={!on} className={`ih-chip${!on ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => { if (on) save({ ...prefs, sounds: false }); }}>Off</button>
      </div>
    </div>
  );
}

/** Which side of the island the tick circle sits on, at rest and open alike (settings.island.tickSide, ps-mac
 *  Island.swift). The developer, 12 Nov 2026: "Make it so it's always on the left. Make this adjustable in the dynamic island
 *  settings too". Left by default, everyone's, in both island settings places. */
export const ISLAND_TICK_LABEL = "Tick circle side";
export const ISLAND_TICK_HINT = "Where the circle you click to tick the task sits, the same whether the island is resting or open.";
export function IslandTickSideRow({ prefs, save }: { prefs: IslandPrefs; save: (p: IslandPrefs) => void }) {
  const islandOn = prefs.mode !== "off";
  const pick = (tickSide: "left" | "right") => { if (prefs.tickSide !== tickSide) save({ ...prefs, tickSide }); };
  return (
    <div className="ih-row" role="group" aria-label={ISLAND_TICK_LABEL}>
      <span className="ih-l">{ISLAND_TICK_LABEL}<em>{islandOn ? ISLAND_TICK_HINT : "The island is off."}</em></span>
      <div className="ih-chips" role="radiogroup" aria-label={ISLAND_TICK_LABEL}>
        <button type="button" role="radio" aria-checked={prefs.tickSide === "left"} className={`ih-chip${prefs.tickSide === "left" ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => pick("left")}>Left</button>
        <button type="button" role="radio" aria-checked={prefs.tickSide === "right"} className={`ih-chip${prefs.tickSide === "right" ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => pick("right")}>Right</button>
      </div>
    </div>
  );
}

export const ISLAND_CARDS_LABEL = "Notifications come from the Dynamic Island";
export const ISLAND_CARDS_HINT = "On: new cards drop out of the island and go back into it. Off, or while the island is off or hidden: the top right, as before.";

export function IslandCardsRows({ prefs, save }: { prefs: IslandPrefs; save: (p: IslandPrefs) => void }) {
  const red = isRedAccount(useVault());   // client emails and lead replies only ever come to the developer's account
  const islandOn = prefs.mode !== "off";
  const on = prefs.cards;
  const listOn = on && islandOn;
  const kinds = CARD_KINDS.filter((x) => red || !x.red);
  return (
    <div className="ih-row ic-row" role="group" aria-label={ISLAND_CARDS_LABEL}>
      <span className="ih-l">{ISLAND_CARDS_LABEL}<em>{islandOn ? ISLAND_CARDS_HINT : "The island is off, so every card shows in the top right."}</em></span>
      <div className="ih-chips" role="radiogroup" aria-label={ISLAND_CARDS_LABEL}>
        <button type="button" role="radio" aria-checked={on} className={`ih-chip${on ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => { if (!on) save({ ...prefs, cards: true }); }}>On</button>
        <button type="button" role="radio" aria-checked={!on} className={`ih-chip${!on ? " sel" : ""}`} disabled={!islandOn}
          onClick={() => { if (on) save({ ...prefs, cards: false }); }}>Off</button>
      </div>
      <div className={`ic-kinds${listOn ? "" : " ic-off"}`} aria-disabled={!listOn}>
        {kinds.map((x, i) => {
          const place = cardPlace(prefs, x.k);
          const usual = x.pop ? "Usual place" : "Top right";   // a pop up's other choice is where it always showed
          return (
            <div key={x.k} className="ic-kind-wrap">
            {x.pop && !kinds[i - 1]?.pop && <span className="ic-head">Pop ups</span>}
            <div className="ic-kind" role="radiogroup" aria-label={x.label}>
              <span className="ic-name">{x.label}</span>
              <span className="ic-seg">
                <button type="button" role="radio" aria-checked={place === "island"} className={`ih-chip${place === "island" ? " sel" : ""}`} disabled={!listOn}
                  onClick={() => { if (place !== "island") save(withCardPlace(prefs, x.k, "island")); }}>Island</button>
                <button type="button" role="radio" aria-checked={place === "top"} className={`ih-chip${place === "top" ? " sel" : ""}`} disabled={!listOn}
                  onClick={() => { if (place !== "top") save(withCardPlace(prefs, x.k, "top")); }}>{usual}</button>
              </span>
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const CHAT_FADE_LABEL = "AI chat cards disappear by themselves";
const fadeText = (n: number) => (n === 0 ? "Off" : `${n} s`);
export function ChatFadeRow({ value, save }: { value: unknown; save: (n: number) => void }) {
  const v = chatFade(value);
  return (
    <div className="ih-row ic-fade" role="group" aria-label={CHAT_FADE_LABEL}>
      <span className="ih-l">{CHAT_FADE_LABEL}<em>{v === 0 ? "Off: each chat stays in the bubble until you dismiss it." : `Finished chats share one bubble, a row each. A row's circle shrinks for ${v} seconds, then that row goes. The pointer on the bubble pauses them. Your phone keeps its notification.`}</em></span>
      <div className="ih-chips" role="radiogroup" aria-label={CHAT_FADE_LABEL}>
        {[0, ...CHAT_FADE_CHOICES].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={v === n} className={`ih-chip${v === n ? " sel" : ""}`}
            onClick={() => { if (v !== n) save(n); }}>{fadeText(n)}</button>
        ))}
      </div>
    </div>
  );
}
