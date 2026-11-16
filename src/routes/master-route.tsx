import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sheet } from "@/components/ui";
import { useMasterModal } from "@/lib/master-modal";
import { HomePage } from "./home";
import { MerciPage } from "./master";

/** Adresse /master (liens existants) : l'accueil s'affiche, MASTER DOGUI s'ouvre en fenêtre ; la fermer ramène à l'accueil. */
export function MasterRoute() {
  const m = useMasterModal(); const nav = useNavigate(); const wasOpen = useRef(false);
  useEffect(() => { m.open(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (m.isOpen) wasOpen.current = true; else if (wasOpen.current) void nav({ to: "/accueil", replace: true }); }, [m.isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  return <HomePage />;
}

/** Adresse /merci (retour de paiement) : l'état réel du paiement s'affiche en fenêtre au-dessus de l'accueil. */
export function MerciRoute() {
  const m = useMasterModal(); const nav = useNavigate(); const close = () => void nav({ to: "/accueil", replace: true });
  return (<><HomePage /><Sheet title="Merci pour votre paiement" onClose={close} size="modal"><MerciPage onOpenMaster={() => { close(); m.open("lic"); }} /></Sheet></>);
}
