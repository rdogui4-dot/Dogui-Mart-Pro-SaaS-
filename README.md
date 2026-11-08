# Dogui Mart Pro SaaS

Gestion de commerce **pour Android** : PWA installable (TanStack Router/Query + React 19 + Tailwind 4) sur **Appwrite** (Auth, Teams, TablesDB). Inspiré des modules d'Odoo (POS, stock, achats, compta) et de Dolibarr (tiers, factures), adapté au petit commerce africain (FCFA, Mobile Money, SYSCOHADA, hors-ligne).

## Démarrage
Backend : projet Appwrite **PRO HRI CENTER** (`6ae9d6010001952ea399`, Francfort). La base `dmp` et ses 12 tables existent déjà.
```bash
npm install
cp .env.example .env
npm run dev
```
### Déployer la fonction serveur (à faire une fois, avec votre compte)
La fonction `dmp-api` est déjà créée dans le projet, mais **son code n'est pas encore déployé**.
```bash
npm i -g appwrite-cli && appwrite login
npm run functions:build        # produit functions/dmp-api/dist/main.js
appwrite push functions        # lit appwrite.json
```
Puis dans la console Appwrite : *Overview → Platforms → Add Web app* avec le domaine de l'application (nécessaire pour que le navigateur puisse appeler Appwrite).
Contrôles : `npm run typecheck && npm test && npm run build`.

## Architecture
- **Multi-tenant** : un commerçant = une *Team* Appwrite (rôles `owner` / `manager` / `cashier`). Chaque ligne porte `tenantId` + `shopId` et des droits de ligne basés sur la Team (`rowPerms`).
- **Domaine pur et testé** (`src/domain`) : montants FCFA, encaissement, fidélité, crédit client, stock par mouvements immuables, écritures SYSCOHADA équilibrées, passerelle Mobile Money.
- **Hors-ligne** : les ventes sont mises en file (IndexedDB) avec un `clientId` unique (idempotent) puis synchronisées ; service worker pour le shell.
- **Scan** caméra via `BarcodeDetector` (Chrome Android).

## Fonctions serveur (`functions/dmp-api`)
Toutes les écritures passent par une seule fonction Appwrite ; **aucune table n'accorde d'écriture aux clients** (lecture seule pour l'équipe du commerçant). La fonction identifie l'appelant via l'en-tête posé par Appwrite, vérifie qu'il est membre confirmé du tenant, puis contrôle son rôle.

| Action | Rôle min. | Ce que fait le serveur |
|---|---|---|
| `checkout` | caissier | Relit prix et stock en base, refuse stock insuffisant / remise non autorisée, vérifie plafond de crédit et lien QR, écrit vente + mouvements + écritures SYSCOHADA, applique crédit et points. Idempotent. |
| `entity.save` | manager (client : caissier) | Produits, clients, fournisseurs ; champs serveur (crédit, points) non modifiables. |
| `stock.adjust` | manager | Inventaire par mouvement d'écart. |
| `credit.repay` | caissier | Remboursement de crédit + écritures. |
| `po.create/cancel` | manager | Bon de commande (prix HT, produits et fournisseur du commerce vérifiés), annulation avant toute réception. |
| `po.receive` | manager | Réception totale ou partielle : mouvements de stock + coût moyen pondéré. Idempotent par `receiptId`. |
| `invoice.supplier.create` | manager | Facture sur les quantités reçues non facturées (TVA incluse) ; écritures 601 + 4452 / 401. Idempotent par `invoiceId`. |
| `invoice.supplier.pay` | manager | Règlement total ou partiel (espèces, Wave, Orange, banque), plafonné au reste dû ; écritures 401 / trésorerie. Idempotent par `paymentId`. |
| `invoice.customer.fromSale` | manager | Facture-document à partir d'une vente (aucune nouvelle écriture comptable : la vente les a déjà passées). Une seule par vente. |
| `invoice.customer.create` | manager | Facture libre (prestation, client professionnel) : prix HT + TVA de la boutique ; écritures 411 / 701 / 4431. Idempotent par `invoiceId`. |
| `invoice.customer.pay` | manager | Encaissement total ou partiel ; pour une vente à crédit, le crédit du client baisse d'autant (plafonné au crédit restant). Idempotent par `paymentId`. |
| `shop.save` | owner | Fiche boutique (nom, adresse, NINEA/RCCM, TVA) utilisée en en-tête des documents. |
| `tenant.init` / `shop.create` | owner | Première boutique (idempotente) / nouvelle boutique (20 max). |
| `staff.create` | owner | Compte employé : identifiant (ou e-mail) + mot de passe initial, rôle `manager` ou `cashier`, boutiques affectées. Rollback complet si une étape échoue. |
| `staff.update` / `staff.resetPassword` | owner | Rôle, boutiques, désactivation (le compte ne peut plus se connecter) ; nouveau mot de passe. Limités aux employés de son commerce. |
| `stock.transfer` | manager (accès aux deux boutiques) | Transfert immédiat entre boutiques : sortie + entrée de stock, produit de destination retrouvé par origine/code-barres ou créé. Idempotent, reprise sûre. |
| `payments.settings.save/get` | owner / caissier | Modèles de lien Wave / Orange Business. |
| `payment_link.create/confirm/cancel/status` | caissier | Lien de paiement, QR, confirmation. |

## Boutiques et employés
- Un commerce (Team Appwrite) peut avoir plusieurs boutiques. **Chaque appel serveur vérifie que la boutique existe dans le commerce de l'appelant et que l'employé y est affecté** (le propriétaire accède à toutes). Un employé désactivé perd l'accès immédiatement.
- Connexion des employés : l'identifiant (sans `@`) est complété en `identifiant@staff.invalid`. `.invalid` est un domaine réservé (RFC 2606) : aucun e-mail de récupération ne peut partir vers un tiers. Test réel : Appwrite accepte ce format. Le propriétaire réinitialise les mots de passe (pas de « mot de passe oublié » pour ces comptes).
- Le catalogue, le stock, les caisses et la comptabilité sont **propres à chaque boutique**. Un sélecteur de boutique apparaît pour qui en a plusieurs.
- **Isolation des lectures par boutique et par rôle.** Chaque ligne reçoit à sa création la liste des rôles autorisés à la lire (`functions/dmp-api/src/permissions.ts`) : le propriétaire lit tout ; les employés lisent via des **étiquettes** que le serveur pose sur leur compte (`s<boutique>` = affecté à la boutique, `g<boutique>` = gérant de la boutique). Caissier : produits, stock, clients, ventes, liens de paiement de **sa** boutique. Gérant : en plus fournisseurs, commandes, factures, compta, journal d'audit de **sa** boutique. Transferts : gérants des deux boutiques. Abonnement et paiements d'abonnement : propriétaire seul. Réglages de plateforme : personne côté client. Les étiquettes sont recalculées à chaque changement de rôle, de boutiques ou d'état (un compte désactivé n'a plus aucune lecture). Un test vérifie que **toute table du schéma a une politique** (une nouvelle table sans politique fait échouer le test et la création de ses lignes : jamais de lecture ouverte par défaut).
- **Vérification réelle** : les tests simulent les permissions Appwrite en mémoire. Après déploiement, lancez `npm run verify:isolation` (clé API requise) : il crée une table et des comptes temporaires, lit « en tant que » chacun, puis nettoie. **Ce script n'a pas encore été exécuté.**
- **Limite restante** : la liste des membres de l'équipe (identifiants, rôles) reste visible de tous les membres du commerce (c'est le comportement des équipes Appwrite).

## Abonnements SaaS
- **Périodes** : Jour, Semaine, Mensuel, Trimestre, Annuel (durées fixes : 1, 7, 30, 90, 365 jours), achetables par multiples (jusqu'à 31 jours, 8 semaines, 12 mois, 4 trimestres, 3 ans).
- **Formules** (quotas boutiques / utilisateurs / produits) : Starter 1/2/200, Business 3/10/2 000, Pro 20/100/illimité. **Les tarifs par défaut sont des valeurs de départ à valider** (`src/domain/subscriptions.ts`) ; l'administrateur les modifie sans redéploiement (Réglages → Plateforme).
- **Essai gratuit** : 14 jours, formule Business, démarré à l'inscription.
- **Quotas appliqués côté serveur** : création de boutique, d'employé (le propriétaire compte ; un compte désactivé libère une place) et de produit (les produits archivés ne comptent pas). Modifier l'existant reste permis.
- **Expiration** : après l'échéance, délai de grâce (jour : 0, semaine : 1 jour, mensuel et plus : 3 jours ; essai : 0), puis **lecture seule** : toute action d'écriture est refusée (402) sauf le renouvellement. Les ventes faites hors ligne pendant le verrou restent en attente et partent après renouvellement.
- **Paiement par liens Selar (sans API)** : Selar vend des offres à **prix fixe**, donc la plateforme configure **un lien par formule et par période** (3 × 5 = 15, Réglages → Plateforme) au prix exact du catalogue. Le propriétaire choisit formule + période : l'application affiche le lien en bouton et en QR code. Après avoir payé sur Selar, il saisit la **référence de commande** reçue par e-mail et **l'e-mail utilisé**. **La plateforme vérifie dans son tableau de bord Selar (commande trouvée, montant exact, e-mail) puis valide** ; aucune vérification automatique n'est possible sans API. Une référence ne sert qu'une fois sur toute la plateforme. Un lien = une période : pour en acheter plusieurs, on répète la démarche (la durée s'ajoute si la formule est la même). Même formule encore active : la durée s'ajoute à l'échéance ; changement de formule : la nouvelle période démarre maintenant (le temps restant de l'ancienne n'est pas reporté). Validation idempotente : une reprise réapplique les mêmes dates et ne raccourcit jamais un abonnement. Les liens doivent être en https ; un domaine qui n'est pas `selar.co` / `selar.com` est signalé à l'administrateur (domaine personnalisé possible) mais pas refusé. Les paiements **en boutique** (clients qui paient leurs achats) restent des liens/QR Wave et Orange Business du commerçant : ils ne passent pas par Selar.
- **Relances d'expiration (sans envoi automatique)** :
  - *Dans l'application* : un bandeau prévient le propriétaire **et les employés** (message adapté : le propriétaire est renvoyé vers Réglages → Abonnement, l'employé est invité à prévenir le propriétaire). Les paliers dépendent de la période : mensuel / trimestre / annuel à J-7 (information), J-3 (avertissement), J-1 (urgent) ; semaine à J-3, J-2, J-1 ; jour dans les dernières heures (12 h, 6 h, 2 h 30) ; un essai est relancé comme un mensuel. Les rappels d'information et d'avertissement se masquent pour la journée ; urgent, délai de grâce et lecture seule restent affichés.
  - *Pour la plateforme* : Réglages → Plateforme → **Relances** liste les abonnements qui se terminent d'ici 7 / 14 / 30 / 90 jours ou sont déjà échus (essais compris), du plus urgent au moins urgent, avec le propriétaire, son téléphone, un **message déjà rédigé**, et les boutons WhatsApp (lien `wa.me`), e-mail (`mailto:`), Copier et « Marquer relancé » (date mémorisée). Un abonnement avec paiement en attente de validation est signalé pour ne pas relancer quelqu'un qui a déjà payé. Le lien WhatsApp exige un numéro avec indicatif ; pour un numéro local, saisissez l'indicatif par défaut (ex. 221), sinon l'application ne devine pas.
  - **Pas d'envoi automatique** : cela demande un service d'envoi (Appwrite Messaging avec un fournisseur SMTP/SMS configuré, ou l'API WhatsApp Business) et une fonction planifiée. Ce n'est pas branché ; la liste est limitée aux 100 échéances les plus proches.
- **Administrateur de la plateforme** : défini par la variable de la fonction `PLATFORM_ADMINS` (identifiants utilisateur séparés par des virgules). Inscrivez-vous dans l'application, copiez « Mon identifiant » (Réglages → Général), puis ajoutez la variable dans la console Appwrite (Functions → DMP API → Settings → Variables) et redéployez. Sans cela, personne ne peut valider les paiements.

## Paiement par QR code (Wave Business / Orange Business)
1. Le propriétaire colle dans *Réglages* le modèle de lien de son compte Business (https, avec `{amount}` et optionnellement `{ref}`). **Les formats exacts de lien ne sont pas codés en dur ni vérifiés ici** : ils viennent de votre compte Business.
2. À la caisse, choisir Wave ou Orange : le serveur crée un lien (réf. `DMP-XXXXXXXX`, validité réglable), l'appli le dessine en QR code.
3. Le client paie ; le caissier saisit l'**ID de transaction** reçu et valide. Un ID ne sert qu'une fois par commerçant, le lien expire, le montant doit correspondre exactement, un lien ne sert qu'à une vente, et tout est tracé dans `audit_log`.
4. **Limite actuelle** : la confirmation est manuelle (le serveur ne peut pas vérifier auprès de l'opérateur). Un webhook / une API opérateur doit la remplacer pour une garantie réelle (voir ROADMAP).

## Documents PDF
Générés **sur le téléphone** (jsPDF chargé à la demande, hors du bundle principal) puis partagés via la feuille de partage Android (WhatsApp, e-mail, impression) ou téléchargés : **facture client** et **bon de commande** (A4, multi-pages) et **ticket de caisse** (rouleau 80 mm, utilisable hors ligne avec le même numéro que celui du serveur). Le modèle de document (`src/domain/documents.ts`) est séparé du rendu (`src/lib/pdf.ts`). L'en-tête vient de *Réglages → Ma boutique*.

## État réel (v2.0.0-alpha)
Vérifié : typecheck, 144 tests (domaine + scénarios de la fonction, dont achats : réception partielle, reprise après plantage, double facturation, règlements sur un store en mémoire : isolation entre commerces, droits, idempotence, plafond de crédit, stock, liens QR), build du front et de la fonction ; base et 12 tables créées dans Appwrite.

**Non vérifié** : aucun appel réel à Appwrite depuis le code (fonction non déployée, adaptateur `appwrite-store.ts` et appels `createExecution` jamais exécutés), rien testé sur un téléphone Android.
**Pas encore fait** : PDF de la facture fournisseur, impression Bluetooth directe du ticket (le PDF se partage mais ne s'imprime pas encore sans passer par une appli d'impression), devis, avoirs, rapports consolidés multi-boutiques, invitation d'employés par e-mail, vérification opérateur des paiements QR. Écarts connus : à la réception, si l'exécution plante après l'enregistrement de la commande mais avant la mise à jour du coût moyen, ce coût n'est pas recalculé à la reprise (le stock, lui, est complété) ; les achats n'ont pas de réception sans bon de commande ni de retour fournisseur ; la dette fournisseur est calculée à partir des factures (le champ `balance` n'est pas utilisé). Autres écarts : le règlement d'une facture issue d'une vente à crédit et la fonction `credit.repay` réduisent le même crédit client sans se synchroniser (si le crédit est remboursé par `credit.repay`, la facture reste « partielle ») ; pour un règlement de facture, une coupure entre la mise à jour de la facture et celle du crédit client peut laisser le crédit non décrémenté. Les transactions Appwrite supprimeraient ces fenêtres. Autre écart : si l'exécution plante entre la mise à jour du client et le passage de la vente à « paid », une reprise pourrait appliquer deux fois le crédit/points de cette vente.
