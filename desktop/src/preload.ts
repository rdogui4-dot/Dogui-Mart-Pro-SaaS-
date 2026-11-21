import { contextBridge, ipcRenderer } from "electron";

/** Pont minimal vers les écrans d'accueil du poste (choix du mode, adresse du poste principal). La page de l'application elle-même n'a AUCUN accès à ce pont. */
// Le pont n'existe QUE sur les écrans internes du poste (fichiers locaux) : jamais dans la page de l'application (réseau).
if (location.protocol === "file:") contextBridge.exposeInMainWorld("dogui", {
  info: (): Promise<{ version: string; mode?: string; mainOrigin?: string; message?: string }> => ipcRenderer.invoke("dogui:info"),
  chooseMode: (mode: "main" | "secondary"): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("dogui:choose-mode", mode),
  probe: (address: string): Promise<{ ok: true; origin: string; fingerprint: string } | { ok: false; error: string }> => ipcRenderer.invoke("dogui:probe", address),
  confirmPin: (origin: string, fingerprint: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("dogui:confirm-pin", origin, fingerprint),
  retry: (): Promise<void> => ipcRenderer.invoke("dogui:retry"),
  reconfigure: (): Promise<void> => ipcRenderer.invoke("dogui:reconfigure"),
});
