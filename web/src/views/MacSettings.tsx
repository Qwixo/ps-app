// Mac settings in the Tab list (V1.23, the developer: "I only want it to be the tab overlay now"). PS's main
// window is gone, so everything that lived behind its gear (PS > Settings) opens here instead. Since V1.32
// it is the Mac settings tab of the gear's full screen Settings (views/SettingsScreen.tsx), with the same
// sections as before (PsSettingsView): gear > Mac settings, or Settings on the "PS is active" pop-up (ps-mac
// Popup.swift calls window.__psOpenSettings, which SettingsScreen answers).
// This page holds no keys: native settings go straight to PS, vault settings through the engine page.
import { PsSettingsView } from "./PsSettings";
import { openSettings } from "./SettingsScreen";
import "./macsettings.css";

/** Old name, kept for callers: true opens Settings on Mac settings, false closes Settings. */
export function openMacSettings(v = true) { openSettings(v ? "mac" : null); }

/** The Mac settings tab's content. */
export function MacSettingsPage() {
  return <PsSettingsView overlay />;
}
