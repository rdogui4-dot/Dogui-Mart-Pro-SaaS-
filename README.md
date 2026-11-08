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
| `payments.settings.save/get` | owner / caissier | Modèles de lien Wave / Orange Business. |
| `payment_link.create/confirm/cancel/status` | caissier | Lien de paiement, QR, confirmation. |

## Paiement par QR code (Wave Business / Orange Business)
1. Le propriétaire colle dans *Réglages* le modèle de lien de son compte Business (https, avec `{amount}` et optionnellement `{ref}`). **Les formats exacts de lien ne sont pas codés en dur ni vérifiés ici** : ils viennent de votre compte Business.
2. À la caisse, choisir Wave ou Orange : le serveur crée un lien (réf. `DMP-XXXXXXXX`, validité réglable), l'appli le dessine en QR code.
3. Le client paie ; le caissier saisit l'**ID de transaction** reçu et valide. Un ID ne sert qu'une fois par commerçant, le lien expire, le montant doit correspondre exactement, un lien ne sert qu'à une vente, et tout est tracé dans `audit_log`.
4. **Limite actuelle** : la confirmation est manuelle (le serveur ne peut pas vérifier auprès de l'opérateur). Un webhook / une API opérateur doit la remplacer pour une garantie réelle (voir ROADMAP).

## État réel (v2.0.0-alpha)
Vérifié : typecheck, 40 tests (domaine + scénarios de la fonction, dont achats : réception partielle, reprise après plantage, double facturation, règlements sur un store en mémoire : isolation entre commerces, droits, idempotence, plafond de crédit, stock, liens QR), build du front et de la fonction ; base et 12 tables créées dans Appwrite.

**Non vérifié** : aucun appel réel à Appwrite depuis le code (fonction non déployée, adaptateur `appwrite-store.ts` et appels `createExecution` jamais exécutés), rien testé sur un téléphone Android.
**Pas encore fait** : factures PDF et impression des bons de commande, factures clients, abonnements/quotas, multi-boutiques (une boutique `default` par commerce), invitation d'employés, vérification opérateur des paiements QR. Écarts connus : à la réception, si l'exécution plante après l'enregistrement de la commande mais avant la mise à jour du coût moyen, ce coût n'est pas recalculé à la reprise (le stock, lui, est complété) ; les achats n'ont pas de réception sans bon de commande ni de retour fournisseur ; la dette fournisseur est calculée à partir des factures (le champ `balance` n'est pas utilisé). Autre écart : si l'exécution plante entre la mise à jour du client et le passage de la vente à « paid », une reprise pourrait appliquer deux fois le crédit/points de cette vente.
