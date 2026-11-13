// Settings > Add Telegram Bot (V1.47, the developer 10 Nov 2026: "Make it so other people can add a Telegram bot as well. Add
// that in the Settings menu as a tab called Add Telegram Bot."). For every account, the public PS too.
// Four steps: make a bot with BotFather, give PS its key (Mac: a small PS window that keeps it in the Keychain, the
// key never enters this page; phone: a box here, kept with the Keystore), link your own Telegram with a six digit
// code, and a test. Then the rules as a cheat sheet, the start word, and Remove.
// The website and the iPhone web app show the steps and the rules; the key and the reading live in PS on a Mac or
// phone (src/tgbot.ts). The developer's own Daily report bot is separate and unchanged.
import { useEffect, useState } from "react";
import { PS, psPost, usePsSettings } from "../ps";
import { GOS } from "../gos/bridge";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { isRedAccount } from "../core/account";
import { sfx } from "../ui/sfx";
import { cheatSheet, cleanPrefix, cleanTgPrefs, looksLikeToken, PREFIX_MAX } from "../core/tgbot";
import type { TgState } from "../core/tgpoll";
import { tgOp, useTgView, type TgView } from "../tgbot";
import { taskMapActions } from "./TaskMap";
import "./telegrambot.css";

type Where = "mac" | "phone" | "web";
const NONE: TgView = { saved: null, bot: null, state: "off", problem: null, linkCode: null, test: "idle", testText: null };

/** What this device knows: the Mac's Tab list hears it from PS (the main page reads the bot), the phone has it here. */
function useView(where: Where): TgView {
  const ps = usePsSettings();
  const phone = useTgView();
  if (where === "phone") return phone;
  if (where === "mac") { const t = ps?.tgBot; return t ? { ...NONE, ...t, saved: t.saved } : NONE; }
  return NONE;
}
function act(where: Where, op: string) {
  sfx.click();
  if (where === "mac") psPost({ type: "tg:op", op });
  else if (where === "phone") void tgOp(op);
}
const STATE: Record<TgState, { t: string; c: "good" | "amber" | "bad" | "" }> = {
  running: { t: "Reading your bot", c: "good" },
  off: { t: "Not reading", c: "" },
  offline: { t: "Waiting for the internet", c: "amber" },
  conflict: { t: "Another device is reading it", c: "amber" },
  webhook: { t: "Used elsewhere", c: "bad" },
  badToken: { t: "Key not accepted", c: "bad" },
  noKey: { t: "No key", c: "" },
};

export function TelegramBotSettings() {
  const where: Where = PS ? "mac" : GOS ? "phone" : "web";
  const s = useVault();
  const prefs = cleanTgPrefs(settingsData(s)?.tgBot);
  const v = useView(where);
  const red = isRedAccount(s);
  const linked = prefs.chatId !== null;
  const saved = v.saved === true;
  const device = where === "mac" ? "this Mac's Keychain" : "this phone's Keystore";
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 5000); return () => clearTimeout(t); }, [sure]);

  const remove = () => {
    if (!sure) { sfx.click(); setSure(true); return; }
    setSure(false); sfx.click();
    if (where === "mac") psPost({ type: "tg:remove" });
    else if (where === "phone") void tgOp("remove");
    else taskMapActions.looks({ tgBot: { ...prefs, chatId: null, who: null } });
  };
  const st = STATE[v.state] ?? STATE.off;
  const redNote = red ? "Your Daily report bot keeps working exactly as it does now: AT tasks still come into New tasks. A bot added here is a second, separate bot, read by PS app itself." : null;

  return (
    <div className="tg-wrap">
      <p className="tg-intro">Text tasks to your own Telegram bot and they land on your PS app list, with the same quick rules as the developer's bot. PS app on your Mac or phone reads the bot while PS app is running. No server in between, and the bot's key never leaves that device.</p>
      {redNote ? <p className="tg-note">{redNote}</p> : null}

      {where !== "web" && saved && (
        <div className="tg-status" role="status">
          <span className={`tg-pill ${st.c}`}>{st.t}</span>
          {v.bot?.username ? <b>@{v.bot.username}</b> : null}
          {v.problem ? <span className="tg-soft">{v.problem}</span> : null}
          {(v.state === "webhook" || v.state === "badToken" || v.state === "off") && linked ? <button type="button" className="btn quiet sm" onClick={() => act(where, "retry")}>Try again</button> : null}
        </div>
      )}

      <ol className="tg-steps">
        <li className={`tg-step${saved ? " done" : ""}`}>
          <h4><i>1</i>Make your bot in Telegram</h4>
          <ol className="tg-how">
            <li>Open Telegram and search for <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> (the one with the blue tick).</li>
            <li>Send <code>/newbot</code>.</li>
            <li>Give it a name, then a username that ends in <code>bot</code>, like <code>ann_tasks_bot</code>.</li>
            <li>BotFather sends you a key that looks like <code>123456789:AAH...</code>. Copy it.</li>
          </ol>
          <p className="tg-soft">Anyone with that key can use your bot, so paste it only into PS app.</p>
        </li>

        <li className={`tg-step${saved ? " done" : ""}`}>
          <h4><i>2</i>Give PS app the bot key</h4>
          {where === "web" ? (
            <p className="tg-soft">Do this in PS app on your Mac or phone. The key stays on that device and never goes to the website or your vault.</p>
          ) : saved ? (
            <p className="tg-ok">Kept in {device}{v.bot?.username ? <>, for <b>@{v.bot.username}</b></> : null}.{" "}
              {where === "mac"
                ? <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); psPost({ type: "tg:key" }); }}>Use another key</button>
                : null}
            </p>
          ) : where === "mac" ? (
            <div className="tg-row">
              <button type="button" className="btn sm" onClick={() => { sfx.click(); psPost({ type: "tg:key" }); }}>Paste bot key</button>
              <span className="tg-soft">A small PS app window opens. PS app keeps the key in this Mac's Keychain and never shows it again.</span>
            </div>
          ) : <PhoneKey />}
        </li>

        <li className={`tg-step${linked ? " done" : ""}${!saved && where !== "web" && !linked ? " later" : ""}`}>
          <h4><i>3</i>Link my Telegram</h4>
          {linked ? (
            <div className="tg-row">
              <p className="tg-ok">Linked to <b>{prefs.who || "your Telegram"}</b>. Only your own messages count; anything else sent to the bot is ignored.</p>
              <button type="button" className="btn quiet sm" onClick={() => { if (where === "web") taskMapActions.looks({ tgBot: { ...prefs, chatId: null, who: null } }); else act(where, "unlink"); }}>Unlink</button>
            </div>
          ) : where === "web" ? (
            <p className="tg-soft">Link it in PS app on your Mac or phone, after step 2.</p>
          ) : v.linkCode ? (
            <div className="tg-link">
              <p>Send this to your bot, or tap the link and press Start:</p>
              <div className="tg-code" aria-label={`Link code ${v.linkCode}`}><code>/start {v.linkCode}</code></div>
              {v.bot?.username ? <a className="btn sm" href={`https://t.me/${encodeURIComponent(v.bot.username)}?start=${v.linkCode}`} target="_blank" rel="noreferrer">Open @{v.bot.username}</a> : null}
              <p className="tg-soft tg-wait"><span className="tg-dot" aria-hidden="true" />Waiting for your message. The code works for 10 minutes.</p>
              <button type="button" className="btn quiet sm" onClick={() => act(where, "cancelLink")}>Cancel</button>
            </div>
          ) : (
            <div className="tg-row">
              <button type="button" className="btn sm" disabled={!saved} onClick={() => act(where, "link")}>Link my Telegram</button>
              <span className="tg-soft">PS app shows a code; you send it to your bot. From then on only your chat is listened to.</span>
            </div>
          )}
        </li>

        <li className="tg-step">
          <h4><i>4</i>Test it</h4>
          {where === "web" ? <p className="tg-soft">The Test button is in PS app on your Mac or phone.</p> : (
            <div className="tg-row">
              <button type="button" className="btn quiet sm" disabled={!saved || v.test === "busy"} onClick={() => act(where, "test")}>{v.test === "busy" ? "Testing..." : linked ? "Send a test message" : "Check the key"}</button>
              {v.testText ? <span className={v.test === "ok" ? "tg-ok" : "tg-bad"} role="status">{v.testText}</span> : null}
            </div>
          )}
          <p className="tg-soft">Then send your bot a task, like <code>{prefs.prefix ? `${prefs.prefix} ` : ""}Email QLA P1</code>. It answers "Added: Email QLA, P1" with an Undo button.</p>
        </li>
      </ol>

      <section className="tg-rules" aria-label="Message rules">
        <h4>The rules</h4>
        <PrefixField prefix={prefs.prefix} onSave={(p) => taskMapActions.looks({ tgBot: { ...prefs, prefix: p } })} />
        <table className="tg-sheet">
          <tbody>
            {cheatSheet(prefs.prefix).map((r) => (<tr key={r.say}><td><code>{r.say}</code></td><td>{r.does}</td></tr>))}
          </tbody>
        </table>
      </section>

      {(saved || linked) && (
        <div className="tg-row tg-remove">
          <button type="button" className={`btn quiet sm${sure ? " danger" : ""}`} onClick={remove}>{sure ? "Sure? Remove it" : "Remove bot"}</button>
          <span className="tg-soft">{where === "web" ? "Unlinks your Telegram." : `Takes the key out of ${device} and unlinks your Telegram. The bot itself stays in Telegram.`}</span>
        </div>
      )}
    </div>
  );
}

/** The phone: a box for the key. It goes straight to the Keystore through the shell and the box is cleared. */
function PhoneKey() {
  const [t, setT] = useState("");
  const good = looksLikeToken(t);
  const save = () => { if (!good) return; sfx.click(); void tgOp("save", { token: t.trim() }); setT(""); };
  return (
    <div className="tg-row">
      <input className="tg-input" type="password" inputMode="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        placeholder="Paste the bot key" aria-label="Bot key from BotFather" value={t} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      <button type="button" className="btn sm" disabled={!good} onClick={save}>Save</button>
      {t && !good ? <span className="tg-soft">That does not look like a bot key yet.</span> : null}
    </div>
  );
}

function PrefixField({ prefix, onSave }: { prefix: string; onSave: (p: string) => void }) {
  const [v, setV] = useState(prefix);
  useEffect(() => { setV(prefix); }, [prefix]);
  const commit = () => { const p = cleanPrefix(v); setV(p); if (p !== prefix) { sfx.click(); onSave(p); } };
  return (
    <label className="tg-field">
      <span>Start word</span>
      <input className="tg-input sm" value={v} maxLength={PREFIX_MAX} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <em>A message that starts with it (same capitals) is a task. Empty: every message is a task. One word, no spaces.</em>
    </label>
  );
}
