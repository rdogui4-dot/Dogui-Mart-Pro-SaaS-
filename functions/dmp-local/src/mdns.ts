import mdns from "multicast-dns";

/** Annonce du poste sur le réseau local (mDNS) : le nom `dogui.local` mène à ses adresses ; le service `_dogui._tcp` permet la découverte par d'autres postes.
 *  Meilleur effort : si le réseau ou le système refuse (port occupé, pas de multicast), le poste reste joignable par son adresse IP. */
export type MdnsInfo = { hostName: string; port: number; ips: string[]; https: boolean };
type Question = { name: string; type: string };

/** Réponses à une question mDNS (pures, testables). */
export function mdnsAnswers(q: Question, info: MdnsInfo): { name: string; type: string; ttl: number; data: unknown }[] {
  const host = `${info.hostName}`.toLowerCase(); const name = q.name.toLowerCase(); const service = "_dogui._tcp.local"; const inst = `Dogui Mart Pro._dogui._tcp.local`; const out: { name: string; type: string; ttl: number; data: unknown }[] = [];
  const isA = (q.type === "A" || q.type === "ANY") && name === host; if (isA) for (const ip of info.ips) out.push({ name: host, type: "A", ttl: 120, data: ip });
  if ((q.type === "PTR" || q.type === "ANY") && name === service) out.push({ name: service, type: "PTR", ttl: 120, data: inst });
  if ((q.type === "SRV" || q.type === "ANY") && name === inst.toLowerCase()) out.push({ name: inst, type: "SRV", ttl: 120, data: { port: info.port, target: host, priority: 0, weight: 0 } });
  if ((q.type === "TXT" || q.type === "ANY") && name === inst.toLowerCase()) out.push({ name: inst, type: "TXT", ttl: 120, data: [`scheme=${info.https ? "https" : "http"}`, "app=dogui-mart-pro"] });
  return out;
}

export function startMdns(info: MdnsInfo): { stop: () => void; running: boolean } {
  try {
    const m = mdns(); m.on("error", () => undefined);
    m.on("query", (query: { questions: Question[] }) => { const answers = query.questions.flatMap((q) => mdnsAnswers(q, info)); if (answers.length) m.respond({ answers: answers as never }); });
    m.on("ready", () => { try { m.respond({ answers: mdnsAnswers({ name: info.hostName, type: "A" }, info) as never }); } catch { /* annonce facultative */ } });
    return { stop: () => { try { m.destroy(); } catch { /* déjà fermé */ } }, running: true };
  } catch { return { stop: () => undefined, running: false }; }
}
