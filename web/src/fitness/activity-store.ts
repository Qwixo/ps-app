// PS Fitness other activities (V1.40): the vault side. One small encrypted record per run, walk, ride or swim (kind
// "fact", owner private, vault key), written through fitPush like every Fitness record: saved on this device first,
// pushed within seconds, the other devices poked. Rules in core/activity.ts. Nothing here sends anything to G Squad.
import { useMemo } from "react";
import { put, remove, setMerger, vaultStore, type Snapshot } from "../core/vault";
import { useVault } from "../ui/kit";
import { fitPush } from "./sync";
import { DEVICE } from "./store";
import { cleanActivity, mergeActivity, type FitActivity } from "../core/activity";

setMerger("fact", (a, b) => mergeActivity(a as FitActivity, b as FitActivity));

export interface ActDoc { id: string; data: FitActivity }
function view(s: Snapshot): ActDoc[] {
  const out: ActDoc[] = [];
  for (const d of s.docs.values()) {
    if ((d.kind as string) !== "fact") continue;
    const a = cleanActivity(d.data);
    if (a) out.push({ id: d.id, data: a });
  }
  return out.sort((a, b) => b.data.date.localeCompare(a.data.date) || b.data.at.localeCompare(a.data.at));
}
/** Every activity in the open vault, newest first. */
export function useActivities(): ActDoc[] {
  const s = useVault();
  return useMemo(() => view(s), [s]);
}
export const activitiesNow = () => view(vaultStore.get());

export function saveActivity(a: Omit<FitActivity, "at" | "device">, id?: string | null): Promise<unknown> {
  const data = cleanActivity({ ...a, at: new Date().toISOString(), device: DEVICE });
  if (!data) return Promise.reject(new Error("That activity could not be read."));
  return fitPush.write(() => put<FitActivity>("fact", data, { id: id ?? undefined, ws: null }));
}
export function deleteActivity(id: string): Promise<unknown> {
  return fitPush.write(async () => { if (vaultStore.get().docs.get(id)?.kind === "fact") await remove(id); });
}
