import { useNavigate } from "@tanstack/react-router";
import { Sheet } from "@/components/ui";
import { useMasterModal } from "@/lib/master-modal";
import { HomePage } from "./home";
import { MerciPage } from "./master";
import { MasterPage } from "./master-page";

/** Adresse /master : page complète MASTER DOGUI (kit écran 20), onglet choisi par ?onglet=ov|chat|rec|rep|pro|lic. */
export function MasterRoute() { return <MasterPage />; }

/** Adresse /merci (retour de paiement) : l'état réel du paiement s'affiche en fenêtre au-dessus de l'accueil. */
export function MerciRoute() {
  const m = useMasterModal(); const nav = useNavigate(); const close = () => void nav({ to: "/accueil", replace: true });
  return (<><HomePage /><Sheet title="Merci pour votre paiement" onClose={close} size="modal"><MerciPage onOpenMaster={() => { close(); m.open("lic"); }} /></Sheet></>);
}
