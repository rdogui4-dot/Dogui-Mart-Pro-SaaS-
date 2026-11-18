/** Base de connaissances IProj Marchés : définitions et repères stables, sans chiffre de marché ni recommandation.
 *  Les valeurs à jour (cours, taux, indicateurs) viennent exclusivement des sources affichées dans l'onglet Marchés. */
export type KItem = { title: string; text: string };
export type KSection = { id: string; title: string; intro: string; items: KItem[] };

export const KNOWLEDGE: KSection[] = [
  { id: "brvm", title: "La BRVM et le marché financier de l'UEMOA", intro: "La Bourse Régionale des Valeurs Mobilières est la bourse commune aux huit pays de l'Union économique et monétaire ouest-africaine.", items: [
    { title: "Qu'est-ce que la BRVM ?", text: "Bourse régionale dont le siège est à Abidjan, commune au Bénin, au Burkina Faso, à la Côte d'Ivoire, à la Guinée-Bissau, au Mali, au Niger, au Sénégal et au Togo. Elle a démarré ses activités en 1998. On y négocie des actions de sociétés cotées et des obligations, en francs CFA." },
    { title: "Qui fait quoi ?", text: "Le marché est régulé par l'AMF-UMOA (Autorité des Marchés Financiers de l'UMOA, anciennement CREPMF). Le Dépositaire Central / Banque de Règlement (DC/BR) conserve les titres et règle les opérations. Un investisseur passe obligatoirement par une SGI (société de gestion et d'intermédiation) agréée pour acheter ou vendre." },
    { title: "Les indices", text: "La BRVM publie des indices qui résument l'évolution du marché, notamment le BRVM Composite (ensemble des actions), le BRVM 30 et le BRVM Prestige. Un indice n'est pas un titre : il sert de point de comparaison." },
    { title: "Actions et dividendes", text: "Une action est une part du capital d'une société. Le rendement vient de la variation du cours et des dividendes éventuels, versés après l'assemblée générale. Le jour du détachement, le cours baisse en général d'environ le montant du dividende." },
    { title: "Fractionnement d'actions", text: "Une société peut diviser la valeur nominale de ses actions (par exemple 1 ancienne = 10 nouvelles). Le cours est divisé d'autant sans changer la valeur détenue : pour comparer dans le temps, il faut ajuster l'historique, ce que fait l'onglet BRVM." },
    { title: "Obligations et titres publics", text: "Les États et les entreprises empruntent en émettant des obligations : l'investisseur prête et reçoit des intérêts (coupons) puis le remboursement à l'échéance. Les titres publics des États de l'UMOA (bons et obligations du Trésor) sont aussi émis par adjudication, avec l'appui de l'agence UMOA-Titres." },
    { title: "OPCVM (FCP, SICAV)", text: "Les fonds communs de placement et SICAV agréés mutualisent l'épargne de nombreux investisseurs et la placent selon une politique définie (actions, obligations, monétaire). Ils permettent de diversifier avec de petits montants, contre des frais de gestion." },
  ] },
  { id: "afrique", title: "Les autres bourses africaines", intro: "Chaque bourse a sa devise, sa réglementation et ses intermédiaires ; investir hors de l'UEMOA ajoute un risque de change.", items: [
    { title: "Johannesburg (JSE)", text: "Bourse d'Afrique du Sud, la plus importante du continent par la capitalisation. Cotations en rand sud-africain." },
    { title: "Lagos (NGX)", text: "Nigerian Exchange, à Lagos. Cotations en naira nigérian ; l'inflation et le change y pèsent fortement sur le rendement réel." },
    { title: "Casablanca, Le Caire, Nairobi, Accra", text: "Bourse de Casablanca (dirham marocain), Egyptian Exchange (livre égyptienne), Nairobi Securities Exchange (shilling kényan), Ghana Stock Exchange (cedi ghanéen)." },
    { title: "Afrique centrale (BVMAC)", text: "Bourse des Valeurs Mobilières de l'Afrique Centrale, à Douala, commune aux pays de la CEMAC (franc CFA d'Afrique centrale, XAF)." },
  ] },
  { id: "monde", title: "Les marchés mondiaux", intro: "Les grandes places financières influencent les taux, les devises et les matières premières, donc indirectement les économies africaines.", items: [
    { title: "Grandes bourses", text: "New York (NYSE et Nasdaq), Londres (LSE), Euronext (Paris, Amsterdam, Bruxelles…), Francfort, Tokyo, Shanghai, Hong Kong." },
    { title: "Indices de référence", text: "S&P 500, Dow Jones et Nasdaq Composite (États-Unis), CAC 40 (France), DAX (Allemagne), FTSE 100 (Royaume-Uni), Nikkei 225 (Japon), MSCI World (actions des pays développés)." },
    { title: "Banques centrales et taux", text: "Les taux directeurs (Réserve fédérale américaine, Banque centrale européenne, BCEAO pour l'UEMOA) orientent le coût du crédit et la rémunération de l'épargne. Le franc CFA étant rattaché à l'euro, la politique de la BCE compte particulièrement pour l'UEMOA et la CEMAC." },
    { title: "Matières premières", text: "Pétrole, or, cacao, coton, café, anacarde… Leurs prix mondiaux pèsent sur les recettes des pays producteurs et sur les coûts des entreprises importatrices." },
  ] },
  { id: "secteurs", title: "Autres secteurs d'investissement", intro: "Au-delà de la bourse, l'investissement productif et les placements bancaires restent les plus courants pour une entreprise.", items: [
    { title: "Immobilier", text: "Achat de locaux, construction, location. Revenus réguliers possibles mais faible liquidité, coûts d'entretien, fiscalité et sécurité juridique du foncier à vérifier (titre foncier)." },
    { title: "Agriculture et agro-industrie", text: "Production, transformation, stockage. Dépend de la saison, du climat et des prix ; la transformation locale capte davantage de valeur ajoutée." },
    { title: "Commerce, distribution, logistique", text: "Nouveau point de vente, stock, véhicules de livraison, entrepôt : c'est le cœur des projets suivis dans IProj (onglet Projets d'investissement)." },
    { title: "Énergie et numérique", text: "Solaire, équipements économes, paiement mobile, vente en ligne : investissements souvent rentabilisés par la baisse des coûts ou de nouveaux clients." },
    { title: "Dépôts et placements bancaires", text: "Comptes et dépôts à terme : capital généralement garanti par la banque, rendement faible, parfois inférieur à l'inflation. À comparer au rendement réel (onglet Économies)." },
    { title: "Épargne informelle (tontines)", text: "Très répandue, utile pour mobiliser une somme, mais sans garantie ni recours juridique en cas de défaillance d'un membre." },
  ] },
  { id: "notions", title: "Notions clés", intro: "Quelques notions pour lire les indicateurs de l'application et de vos interlocuteurs.", items: [
    { title: "Rendement et risque", text: "Un rendement attendu plus élevé s'accompagne presque toujours d'un risque plus élevé, y compris celui de perdre une partie du capital. Les performances passées ne préjugent pas des performances futures." },
    { title: "Rendement réel", text: "Rendement réel ≈ rendement nominal − inflation. Un placement à 5 % quand l'inflation est de 6 % fait perdre du pouvoir d'achat." },
    { title: "Liquidité", text: "Facilité à revendre rapidement un actif sans perte de prix. Les petites bourses et l'immobilier sont peu liquides : prévoir un horizon long." },
    { title: "Diversification", text: "Répartir entre plusieurs actifs, secteurs et pays réduit l'effet d'un problème isolé. L'onglet Portefeuille mesure la concentration de vos placements." },
    { title: "Risque de change", text: "Un placement en dollar, naira ou rand varie aussi avec le taux de change face au FCFA. L'euro, lui, est à parité fixe (655,957 FCFA)." },
    { title: "Rendement du dividende et PER", text: "Rendement du dividende = dernier dividende ÷ cours. PER = cours ÷ bénéfice par action : il indique combien d'années de bénéfices le marché paie. Ces ratios se comparent entre sociétés d'un même secteur." },
    { title: "VAN, TRI et coût du capital", text: "Pour un projet, la VAN actualise les flux au coût du capital (rendement minimum exigé) ; le TRI est le taux qui annule la VAN. Un projet dont le TRI dépasse le coût du capital crée de la valeur, selon vos hypothèses." },
  ] },
  { id: "avant", title: "Avant d'investir : les questions à se poser", intro: "Une liste de contrôle simple, à compléter avec un professionnel agréé.", items: [
    { title: "Objectif et horizon", text: "À quoi servira cet argent, et quand en aurai-je besoin ? Ne pas immobiliser la trésorerie nécessaire à l'activité (onglet Suivi & rentabilité : capacité observée)." },
    { title: "Perte acceptable", text: "Quelle baisse puis-je supporter sans mettre l'entreprise en difficulté ? Renseignez votre profil de risque." },
    { title: "Intermédiaire agréé", text: "Vérifier l'agrément de la SGI, de la société de gestion ou de la banque auprès du régulateur. Se méfier des rendements « garantis » élevés : c'est le signe habituel d'une escroquerie." },
    { title: "Coûts et fiscalité", text: "Frais de courtage, de garde, de gestion, impôts sur les dividendes et plus-values : ils réduisent le rendement net." },
    { title: "Documents", text: "Lire la note d'information ou le prospectus visé par le régulateur, les derniers états financiers et l'historique des dividendes." },
  ] },
];
