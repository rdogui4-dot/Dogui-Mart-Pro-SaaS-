import { createContext, useContext } from "react";

export type MasterTab = "lic" | "rep" | "pro" | "rec" | "chat";
/** Ouverture de la fenêtre MASTER DOGUI depuis n'importe quel écran, sans changer de page (le travail en cours reste intact). */
export const MasterModalCtx = createContext<{ open: (tab?: MasterTab) => void; close: () => void; isOpen: boolean }>({ open: () => {}, close: () => {}, isOpen: false });
export const useMasterModal = () => useContext(MasterModalCtx);
