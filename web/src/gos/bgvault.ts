// The developer's own background videos on the phone: the shared code is src/core/bgvault.ts (the Mac uses
// it too). Here only the phone's bridge: the shell keeps each video encrypted with a key from the
// phone's Keystore, and the page plays it with the automatic portrait crop.
// Also tells the shell who unlocked ({type:"owner", red}), the same as on the Mac (public PS).
import { setBgVideos } from "../ps";
import { gosPost, onShell } from "./bridge";
import { bgAllowed, startBgVault as start } from "../core/bgvault";
import { vaultStore } from "../core/vault";

export { useVaultVideos, type VaultVideo } from "../core/bgvault";

export function startBgVault() {
  let said: boolean | null = null;
  const sayOwner = () => {
    const s = vaultStore.get();
    if (s.status !== "unlocked") { said = null; return; }
    const red = bgAllowed(s);
    if (red !== said) { said = red; gosPost({ type: "owner", red }); }
  };
  vaultStore.subscribe(sayOwner);
  start({ post: gosPost, listen: onShell, publish: setBgVideos, crop: true });
}
