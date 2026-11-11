# MASTER DOGUI — étape 3 : profil d'entreprise — audit et plan (à valider)

Aucun code écrit à ce stade. Références : cahier des charges v1.1, §5 et §5.1.

## 1. Ce qui existe (vérifié dans le dépôt)
| Besoin du cahier (§5) | Existant | Constat |
| --- | --- | --- |
| Identité, localisation | `shops` : name, city, phone, address, legal, vatRatePct, promoTz | Par boutique ; aucune notion d'entreprise (secteur, forme d'activité, taille, pays, devise) |
| Magasins, équipes | `shops`, `staff` (rôle, boutiques, droits) | Disponible, à lire, pas à copier |
| Catalogue, fournisseurs, conditions | `products`, `suppliers` (paymentTerms, leadDays, categories) | Disponible |
| Clientèle, canaux | `customers` (catégorie, source, consentements), `sales` (modes de paiement) | Disponible |
| Objectifs, contraintes, priorités, seuils | seuils épars (stock, dépenses, marge min, tolérance de caisse) dans leurs modules | Pas d'objectifs ni priorités déclarés |
| Historique des décisions | `audit_log` (technique) | Pas de décisions « recommandation acceptée/refusée » (étape 4) |
| Mémoire qualifiée, isolée, journalisée | rien | À créer |

## 2. Constat clé : deux sortes d'informations
- **Dérivées** (boutiques, équipe, catalogue, fournisseurs, canaux de paiement…) : elles existent déjà dans les modules. Les copier dans un profil créerait des doublons périmés. **Proposition : ne jamais les stocker ; le profil les lit à la demande et les affiche comme « vérifié (module X) » avec la date de lecture.**
- **Déclarées ou estimées** (secteur, forme d'activité, taille, pays, objectifs, contraintes, priorités, saisonnalité, remarques) : n'existent nulle part ; c'est la vraie mémoire à créer.

## 3. Plan proposé
**Table `md_profile`** (une ligne par fait, pas un gros document : modification, qualification et suppression par fait) : `tenantId`, `key` (liste fermée), `value`, `kind` (`declared` | `hypothesis` | `estimate`), `source`, `confirmedBy`, `confirmedAt`, `updatedBy`, `shopId` (vide = entreprise). Index unique (tenant, key, shop). Permissions : propriétaire seul en écriture via fonction ; lecture propriétaire et gérants autorisés pour les faits non sensibles. `kind: verified` n'est jamais stocké : il est calculé à la lecture depuis les modules.

**Règles (§5.1) appliquées**
- Chaque fait porte source, date, auteur ; toute modification/suppression est journalisée (`audit_log`, chaîne existante) ; suppression d'un fait sans toucher aux rapports déjà produits (ils embarquent leurs propres données).
- Un fait de type `hypothesis`/`estimate` ne devient `declared` que par **confirmation explicite** d'un utilisateur autorisé (action dédiée, journalisée) ; aucun automatisme ne peut le promouvoir.
- Isolation : toutes les lectures filtrées par `tenantId` du contexte serveur ; test d'isolation entre deux entreprises ; mémoire jamais partagée.
- Liste de clés fermée et validée (type, longueur, valeurs autorisées) : pas de texte libre non borné ; texte libre limité aux « remarques » (≤ 300 car.), marqué comme déclaré, jamais interprété comme instruction (prévention d'injection pour l'étape assistant).
- Respect de la licence : lecture seule du profil en mode consultation ; écriture réservée à une licence valide (cohérent avec `needMaster`).

**Clés initiales proposées** : secteur d'activité (liste), forme d'activité (commerce de détail / gros / mixte), taille (nb d'employés : tranche), pays, objectif principal (marge, volume, trésorerie, croissance), priorités (≤ 3), contraintes (texte court), saison forte (mois), seuils d'alerte préférés. Les valeurs de listes sont à valider par vous (je ne les invente pas de façon définitive).

**Actions serveur** : `md.profile` (lecture : faits stockés + faits vérifiés calculés), `md.profile.set`, `md.profile.confirm`, `md.profile.delete`. Une seule fonction `dmp-api`, aucune nouvelle fonction publique.

**Interface** : onglet « Profil » dans MASTER DOGUI : liste groupée (Vérifié par les modules / Déclaré / Hypothèse / Estimation), badge de qualification, source et date, modification, confirmation, suppression ; assistant de première saisie en 5 questions optionnelles (passables).

**Tests** : qualification, promotion refusée sans confirmation, isolation inter-entreprises, droits par rôle, journalisation, licence expirée, valeurs hors liste refusées, suppression sans effet sur les rapports.

**Hors périmètre de cette étape** : alimenter le profil par l'IA (étape assistant), historique des décisions (étape 4, recommandations).

## 4. Décisions à valider avant le code
1. **Qui édite le profil** : propriétaire seul (défaut du cahier) ou aussi les gérants ?
2. **Faits dérivés non stockés** (section 2) : d'accord ?
3. **Liste de clés et de valeurs** (secteurs, tailles, objectifs) : acceptez-vous la liste ci-dessus, ou voulez-vous la modifier ?
4. **Profil par boutique** : un fait peut-il être propre à une boutique (ex. horaires, objectif) en plus du niveau entreprise ? (le plan le permet via `shopId`).
5. **Suppression** : définitive (défaut du cahier, avec trace dans le journal) ou archivage restaurable ?
