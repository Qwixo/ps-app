// Starts the PS pages' Esc (ui/escape.ts) before any other module adds a keydown listener on window. Imported first
// by main.tsx. The website starts it too (V1.44), for its To-do page in web form: there a real Esc steps back one
// window at a time, as in PS. The phone build leaves window alone.
import { startEscape } from "./ui/escape";

if (import.meta.env.MODE === "ps") startEscape();
else if (import.meta.env.MODE !== "gos") startEscape({ web: true });
