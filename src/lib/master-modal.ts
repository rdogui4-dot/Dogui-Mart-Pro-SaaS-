import { createContext, useContext } from "react";

export type MasterTab = "ov" | "lic" | "rep" | "pro" | "rec" | "chat";
/** Accès à la page MASTER DOGUI (/master?onglet=…) depuis n'importe quel écran : bouton de la barre supérieure, menu, rappels. */
export const MasterModalCtx = createContext<{ open: (tab?: MasterTab) => void; close: () => void; isOpen: boolean }>({ open: () => {}, close: () => {}, isOpen: false });
export const useMasterModal = () => useContext(MasterModalCtx);
