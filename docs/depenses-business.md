# Dépenses et sorties de caisse (Business)

Module intégré à la caisse existante (formule **Business** ou supérieure, fonction `expenses`, vérifiée côté serveur). Aucune table existante n'a été recréée : `cash_movements`, `cash_sessions`, `suppliers`, `staff`, `shops` sont réutilisées et complétées.

## Données (Appwrite TablesDB, isolées par `tenantId` + `shopId`)
| Table | Rôle |
|---|---|
| `expenses` | la dépense (libellé, catégorie, montant, date de dépense, moyen, référence, bénéficiaire/fournisseur, origine caisse ou compte externe, session, justificatifs, statut, auteur, `meta`) — jamais supprimée |
| `expense_events` | historique en ajout seul : création, validation, rejet, modification (avant/après), justificatif, annulation |
| `expense_categories` | catégories personnalisées (archivées, jamais supprimées) ; 11 catégories prédéfinies dans le code |
| `cash_movements` (+ `expenseId`, `beneficiary`) | la sortie d'espèces liée à une dépense |
| `shops` (+ `expenseThreshold`, `expenseSensitive`), `staff` (+ `expenseRights`) | seuil de validation, catégories sensibles, droits par employé |
| Storage | justificatifs (JPEG/PNG/WebP/PDF) dans le bucket `articles` (étendu au PDF, 3 Mo) : le plan Appwrite est limité en buckets ; lecture réservée au propriétaire et aux employés de la boutique |

## Règles garanties par le serveur
- **Droits** : consulter, créer, modifier, valider, annuler (propriétaire/gérant : tous ; caissier : créer + voir les siennes ; réglables par employé par le propriétaire).
- **Validation hiérarchique** : au-dessus du seuil ou catégorie sensible (par défaut salaires, taxes) → « en attente » ; **aucun effet sur la caisse** tant qu'elle n'est pas validée ; on ne valide pas sa propre dépense ; un rejet exige un motif et reste dans l'historique ; la fermeture d'une session est refusée tant qu'une dépense de cette session est en attente.
- **Sortie de caisse** : une dépense « payée depuis la caisse » (espèces) exige une session ouverte et crée, dans la **même transaction Appwrite**, la dépense, son historique, l'audit et le mouvement de caisse → déduit du solde théorique, visible dans la session et dans la clôture (`expenseOut`). Une dépense « compte externe » n'a aucun effet sur la caisse.
- **Solde** : une sortie supérieure au solde théorique est refusée, sauf dépassement explicite, motivé (5 caractères), par un responsable ayant le droit de valider ; tracé dans la dépense, l'historique et l'audit.
- **Jamais deux fois** : `requestId` obligatoire (idempotence, y compris en parallèle), mouvement à identifiant déterministe (une double validation simultanée ne produit qu'une sortie), et un doublon probable (même montant, libellé, bénéficiaire, date, même auteur en 10 min) exige une confirmation explicite.
- **Annulation** = opération corrective : statut « annulée », motif obligatoire ; si la session d'origine est ouverte, une entrée de régularisation est écrite ; sinon aucun mouvement automatique (dit clairement). Montant, date et moyen d'une dépense validée ne se modifient pas (annuler puis ressaisir).
- **Justificatifs** : remplacés par le code de validation (voir plus bas) ; les anciens restent consultables.
- Chaque écriture ajoute une ligne d'audit ; en formule Pro, les sorties alimentent aussi le journal financier immuable.

## Rapports (`expense.report`, chiffres réels uniquement)
Total du jour et du mois, de la période et de la période précédente (écart en %), par catégorie, moyen de paiement, origine, boutique, jour ; sorties d'espèces par session ; dépenses en attente (hors totaux). Exports PDF / Excel / CSV via le moteur d'export existant. **Chiffre d'affaires, dépenses, marge brute et résultat sont distincts** : le résultat = marge brute HT − dépenses validées, affiché **seulement** si le coût d'achat de toutes les ventes est connu, s'il y a des ventes et qu'aucune dépense n'est en attente ; sinon les raisons sont listées. Le tableau de bord Business affiche « Dépenses validées » ; le pilotage Pro remplace l'ancien « non saisies » par les vrais chiffres.

## Limites assumées
- Les montants de dépenses sont pris tels que saisis (TVA non séparée) : le résultat est une estimation d'exploitation, pas un bénéfice comptable.
- Les dépenses nécessitent une connexion (validation et caisse côté serveur) : pas de file hors ligne pour ce module.
- Une dépense en attente liée à une session ne peut plus être validée si cette session est fermée (rejet ou annulation à la place).
- Les « autres moyens configurables » se limitent à un libellé libre sur le moyen « Autre ».
- Le Storage est en lecture privée : l'aperçu passe par un téléchargement authentifié (pas de lien partageable).

## Code de validation (remplace le justificatif)
**Principe** : la preuve d'une dépense n'est plus une pièce jointe mais l'accord d'un gérant ou du propriétaire, matérialisé par un code qu'il est seul à pouvoir lire.

**Workflow**
1. Un employé **sans droit de valider** enregistre la dépense → statut « en attente du code » ; **aucun effet sur la caisse**.
2. Un gérant/propriétaire ouvre la dépense et choisit « Afficher le code » (8 caractères, ex. `K7QM-2XVD`). Sa consultation est tracée dans l'historique.
3. Il communique le code au vendeur, en personne.
4. Le vendeur le saisit dans l'application → le serveur vérifie, valide la dépense et écrit la sortie de caisse dans la même transaction Appwrite (« validée par le code d'un responsable »).
Un gérant/propriétaire qui enregistre lui-même une dépense n'a pas à saisir de code ; il peut aussi valider ou rejeter directement (comme avant).

**Sécurité (côté serveur)**
- Code dérivé par HMAC-SHA256 (clé serveur) de la dépense (identifiant, montant, libellé, catégorie, origine, auteur), d'un numéro d'émission **et de l'identifiant du responsable** : chaque responsable a SON code pour une même dépense : **jamais stocké, jamais renvoyé au vendeur** (`expense.get` ne le contient pas). Modifier la dépense change le code.
- Usage unique (la dépense passe « validée ») ; validité 12 h ; **5 essais** incorrects verrouillent, le responsable doit **renouveler** (l'ancien code devient invalide).
- Seul l'auteur saisit le code ; l'auteur ne peut ni lire ni renouveler son propre code (sauf propriétaire) ; comparaison en temps constant ; double saisie simultanée = une seule sortie.
- Le code ne permet pas de dépasser le solde de caisse : cela reste réservé à la décision explicite d'un responsable.
- Historique : `code_viewed` (qui), `code_failed`, `code_renewed`, `approve` (méthode « code »). Journal d'audit correspondant ; le mouvement de caisse porte `authorizedBy: "code"`.

**Réglage** : « Code obligatoire » (propriétaire, par boutique, activé par défaut). Désactivé, on revient aux règles seuil / catégories sensibles.

**Justificatifs** : plus aucune nouvelle pièce jointe (`expense.receipt` répond 410) ; les pièces déjà enregistrées restent consultables, rien n'est supprimé.

**Qui a validé** : à la saisie, le serveur compare le code à celui de chaque responsable habilité (propriétaires et employés avec le droit « valider », hors auteur) ; celui qui correspond est enregistré comme validateur (`decidedBy`, `authorizedBy` du mouvement de caisse, historique « validée par X, code saisi par Y », journal d'audit). Un responsable qui perd son droit ne valide plus.

**Limite** : le code prouve qu'un responsable a *communiqué* son code personnel, pas qu'il a vu un document ; si un responsable confie son code à un tiers, la validation reste à son nom.
