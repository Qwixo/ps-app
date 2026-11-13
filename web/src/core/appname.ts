// The app's name (V1.36, the developer 6 Nov 2026: "on the public release, call it 'To Do List - by Cincee' and when installing
// give the option to rename the app ... And in the settings menu make it so you can change the name of the app too").
// On the Mac the name is the .app folder's name in Applications (ps-mac Sources/AppName.swift). The Mac shell tells
// every page before it runs (window.__psAppName); the website and the phone have none and say "PS app".
// V1.49 (the developer, 12 Nov 2026: "change the name of the app to 'PS app' for everyone, even on the public release"):
// the default is "PS app" on the Mac, the phone and the website, private and public. The folders older versions
// made by themselves ("PS", "To Do List - by Cincee") read as "PS app" too, so a Mac that has not updated its app
// yet (the web files update on their own) still says it; a name a person picked is kept as typed.
// The rules below are the same as AppName.swift's, so the App name row can say what is wrong before PS is asked;
// PS checks again (and checks the name is free in Applications) before it renames anything.

export const DEFAULT_APP_NAME = "PS app";
export const PUBLIC_APP_NAME = DEFAULT_APP_NAME;
/** Names older versions gave the app by themselves (not a choice a person made). */
export const OLD_DEFAULT_NAMES = ["PS", "To Do List - by Cincee"];
/** The mobile web app at cincee.com/todolist-mobile (Home Screen name, page titles). Also in todolist-mobile/static/manifest.webmanifest. */
export const MOBILE_APP_NAME = "PS app";
export const APP_NAME_MAX = 60;

/** What a person typed, tidied the way PS tidies it: ends trimmed, runs of spaces made one, a typed ".app" dropped. */
export function tidyAppName(raw: string): string {
  let s = String(raw ?? "").normalize("NFC").trim();
  if (s.toLowerCase().endsWith(".app")) s = s.slice(0, -4).trim();
  return s.split(" ").filter(Boolean).join(" ");
}

/** null when `name` (tidied) can be a name, else what is wrong in plain words (the same words PS uses). */
export function appNameProblem(name: string): string | null {
  if (!name) return "Type a name first.";
  if ([...name].length > APP_NAME_MAX) return `That name is too long. Keep it to ${APP_NAME_MAX} characters or fewer.`;
  if (name.includes("/") || name.includes(":")) return "A name cannot have / or : in it.";
  if (name.startsWith(".")) return "A name cannot start with a dot.";
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return "A name cannot have tabs, line breaks or hidden characters in it.";
  if (new TextEncoder().encode(name).length + 4 > 255) return "That name is too long. Keep it shorter.";
  return null;
}

/** A name the shell handed over is used only when it is one PS could have made; anything else reads as "PS app".
 *  The names older versions gave the app by themselves read as "PS app" too (any capitals). */
export function cleanAppName(v: unknown): string {
  if (typeof v !== "string") return DEFAULT_APP_NAME;
  const t = tidyAppName(v);
  if (OLD_DEFAULT_NAMES.some((o) => o.toLowerCase() === t.toLowerCase())) return DEFAULT_APP_NAME;
  return t === v.normalize("NFC") && !appNameProblem(t) ? t : DEFAULT_APP_NAME;
}

/** After the app's name where the text sends people to a list macOS draws itself (Privacy & Security): macOS may
 *  still show the name built into the app, PS app. Empty while the app is called PS app. */
export function macListHint(name = appName()): string {
  return name === DEFAULT_APP_NAME ? "" : ` (macOS may list it as ${DEFAULT_APP_NAME})`;
}

let cached: string | null = null;
/** The name this app goes by: the Mac app's folder name, "PS app" on the website and the phone. */
export function appName(): string {
  if (cached === null) cached = cleanAppName(typeof window === "undefined" ? undefined : (window as Window & { __psAppName?: unknown }).__psAppName);
  return cached;
}
