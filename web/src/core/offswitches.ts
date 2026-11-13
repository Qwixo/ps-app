// Off switches for the open source build: every public feature can be switched off by the person using PS, in the
// public build too. Each one here is a synced setting (or, for the phone's screen time, a phone shell pref) that is ON
// unless switched off, so existing users see no change. Pure (no imports), so tests/offswitches.test.ts can run it.
//   squadAutoJoin  Settings, G Squad: "Join The G Squad automatically" (squad/autoengine.ts, core/squadauto.ts shouldJoin)
//   psPresence     Settings, Privacy and sharing: "Tell the website PS app is open" (src/ps.ts startPsPresence)
//   tipsShow       Settings, About and updates: "Show first use tips" (views/Tips.tsx)
//   screenTime     Settings, Time and reset on the phone: "Track my screen time" (gos/bridge.ts, ps-gos ScreenTime.today)

/** On unless switched off (missing, or anything but false, is on). */
export const onUnlessOff = (v: unknown): boolean => v !== false;

/** G Squad: PS joins The G Squad by itself after sign in. */
export const squadAutoOn = onUnlessOff;
/** The private "ps-presence" Realtime channel, so the website leaves Tab to PS app while it is open. */
export const presenceOn = onUnlessOff;
/** The first use tip cards. */
export const tipsOn = onUnlessOff;
/** The phone counts how long each app is in front. */
export const phoneScreenTimeOn = onUnlessOff;
