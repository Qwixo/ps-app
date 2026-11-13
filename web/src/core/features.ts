// Feature switches: one constant per feature that is switched off but kept, so it can come back with one line.

/** Cincee Campaigns in the PS app (the pink envelope left of Dimension X and its stats panel): OFF since V1.55
 *  (the developer, 12 Nov 2026: "It doesn't work and barely updates ... remove it in a way that is VERY easy to add back").
 *
 *  Off means: no button and no panel in the Tab list (Mac and phone), no "Campaign stats" in Edit mode's tray, no
 *  "Campaigns" in the phone's menu, no live refresh (no call to the campaigns-live function, no polling, no timer),
 *  no stats record handed to the Tab list, and no "Claude updated your vault: Cincee Campaigns" notice.
 *
 *  Kept, untouched: every view (views/CampaignStats.tsx, CampaignsLive.tsx, CsAccounts.tsx), the ops putCampaignStats
 *  and putCampaignsPage (still in App.tsx's KNOWN set, so an old or new package is accepted and its data kept), the
 *  "cstats" records, the campaigns-live edge function on Supabase, and the cincee.com/campaigns web page.
 *  The Mac shell (ps-mac) has no campaign code that runs: only self test steps (see ps-handover-notes/campaigns-off.md).
 *
 *  To bring it back: set this to true. Then see ps-handover-notes/campaigns-off.md for what to check. */
export const CAMPAIGNS_ON = false;

/** The five Notebook looks (Legal pad, Composition, Graph paper, Kraft dotted, Chalkboard, V1.30): OFF since V1.55
 *  (the developer, 12 Nov 2026: "They all look stupid and no one uses them ... remove them in a way that they can be added in later").
 *
 *  Off means: Settings, Appearance offers no Notebook column and no Notebook look (or its Preview), anything that lists
 *  the looks must use offeredLooks() in core/looks.ts (the one list, so the "Page look" menu is covered too), and
 *  anyone whose saved look is a Notebook look (look or tmNotebook) sees the normal look: resolveAppearance() in
 *  core/looks.ts hands out the fallback and the saved choice in the vault is left alone. notebook.css is not loaded
 *  (views/TaskMap.tsx), so no Notebook CSS runs and the four handwriting fonts are never fetched.
 *
 *  Kept, untouched: core/looks.ts's five look specs, core/notebook.ts, views/notebook.css, src/assets/fonts/notebook/
 *  (Sleep mode uses those fonts on its own), the engine's page turn, the settings fields look and tmNotebook.
 *
 *  To bring them back: set this to true. Then see ps-handover-notes/campaigns-off.md for what to check. */
export const NOTEBOOK_ON = false;
