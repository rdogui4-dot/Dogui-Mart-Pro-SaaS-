# ICompta Pro

Fonction `icomptaPro` (forfait **Pro**). Elle s'ajoute à ICompta Business sans rien modifier de ses garanties : écritures validées immuables, numérotation continue, chaîne d'empreintes SHA-256, scellés de clôture, séparation des rôles, piste d'audit.

> **Aucun taux, aucune durée, aucun compte ni règle fiscale n'est inventé.** Tout paramétrage vient de l'utilisateur et doit être validé par un expert-comptable. Les états produits ne sont pas réglementaires.

## Ce que le Pro apporte

| Domaine | Comportement |
| --- | --- |
| **Double approbation** | Le propriétaire fixe un seuil (FCFA). À partir de ce total, **deux approbateurs distincts** (propriétaire ou gérant) sont exigés ; option « un propriétaire doit figurer parmi eux ». L'auteur ne peut pas approuver (sauf propriétaire, signalé « auto-validée »). Un même approbateur ne compte qu'une fois. Les approbations sont **scellées dans l'empreinte** de l'écriture. |
| **Pièces avec empreinte** | Fichiers PDF/JPEG/PNG/WebP (1,8 Mo, format contrôlé par signature binaire). L'empreinte SHA-256 est **calculée par le serveur**, stockée dans l'écriture, donc dans la chaîne. Ajout/retrait seulement sur un brouillon. Action « Vérifier l'intégrité » : recalcul à partir du fichier stocké (intact / altérée / absente). |
| **Lettrage** | Factures clients/fournisseurs **intégralement réglées** uniquement (pas de lettrage partiel inventé). Lettres A, B… par tiers, attribution unique (deux lettrages simultanés d'une même facture : un seul gagne). Défaire exige un motif et reste visible. Le lettrage ne modifie aucune écriture. |
| **Immobilisations** | Registre avec comptes d'immobilisation, d'amortissements et de dotation choisis **dans votre plan**. Amortissement **linéaire** : durée en mois et convention du premier mois (mois de mise en service / mois suivant) **saisies par vous, sans valeur par défaut**. Mensualité = plancher((coût − résiduel) / mois), reliquat sur la dernière. Les dotations échues deviennent des **propositions** (brouillon → à valider) ; la clôture reste bloquée tant qu'elles ne sont pas traitées. Cession/rebut : écriture équilibrée (amortissements cumulés validés, encaissement, résultat, coût), exigeant que les dotations soient validées. Une immobilisation ne se supprime jamais. |
| **Analytique** | Axes **activité** et **projet** (codes créés par vous, désactivables, jamais supprimés) portés par les lignes d'écriture ; empreintes des écritures existantes inchangées. Option propriétaire : activité obligatoire sur les comptes 6 et 7. Rapports par activité/projet avec comparaison de deux périodes ; « (sans axe) » regroupe le non étiqueté (aucune répartition arbitraire). |
| **Clôture guidée** | Étapes numérotées avec accès direct au traitement. Contrôles Pro : **rapprochement bancaire** clôturé (FinI) jusqu'à la fin de période et solde du relevé = compte comptable (seulement si vous avez relié le compte financier à un compte du plan), cohérence clients (information). |
| **États** | **Résultat provisoire indicatif** = produits (classe 7) − charges (classe 6). Bilan/compte de résultat par **correspondance fournie par l'expert-comptable** (préfixes de comptes → lignes, plus long préfixe gagnant, comptes non rattachés listés). Sans correspondance : aucun état officiel. Exports PDF/Excel/CSV journalisés. |
| **Perte de stock** | Mouvements `loss` valorisés quantité × coût de l'article, proposés avec la règle de comptes que **vous** définissez ; sans règle ou sans coût : proposition **bloquée** et visible (la clôture le signale). |

## Droits

- Lecture (historique, listes, états, rapports) : propriétaire, gérants, comptable — **même après retour à Business**.
- Création/modification Pro : propriétaire et gérants, forfait Pro requis (402 sinon). Seuil de double approbation et obligation d'activité : **propriétaire seul**.
- Chaque action sensible est journalisée (`icompta.*`) ; rien ne se supprime.

## Retour de Pro à Business

Toutes les données restent lisibles. Les nouvelles actions Pro sont refusées. Le seuil de double approbation n'est plus appliqué ; une écriture déjà approuvée une fois se valide par un second responsable et **embarque ses approbations dans l'empreinte**. Les axes analytiques ne peuvent plus être saisis.

## Données (Appwrite, base `dmp`)

`acct_assets`, `acct_letters`, `acct_dims` (+ colonnes `approvals`, `level` sur `acct_entries`) ; index `shop` sur `[tenantId, shopId]`. Le paramétrage Pro vit dans la clé `pro` de `acct_config` (la sauvegarde Business la préserve).

## Limites assumées

- Comptabilité tenue **par boutique** : pas de consolidation multi-boutiques dans ICompta (voir FinI).
- Chaîne d'empreintes : elle **détecte** toute altération mais ne l'empêche pas pour quelqu'un qui contrôlerait la base ; noter l'empreinte de tête à intervalles réguliers (hors application) renforce la preuve.
- Aucun amortissement dégressif, aucune convention de cession (prorata) ni aucune règle fiscale : à traiter avec l'expert-comptable.
- Stock : seule la perte valorisée est couverte ; pas de rapprochement valeur de stock / compte de stock.
- Rapprochement bancaire : repose sur les rapprochements clôturés dans FinI.
